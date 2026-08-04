'use strict';

// Copy Mint — watch target wallets on-chain, detect their NFT mints, and
// replicate the exact mint transaction with your own wallets in the same
// block window. Detection is done via eth_getLogs (Transfer from 0x0 → target);
// replication replays the target's original calldata from your own wallets.
//
// NOTE ON RECIPIENT: most public mints (`mint(qty)`, SeaDrop `mintPublic`) mint
// to msg.sender, so replaying identical calldata mints to YOUR wallet. Some
// contracts encode the recipient inside calldata — for those, the copy would
// mint to the target again. This is an inherent limitation of raw replay and is
// surfaced in the feed as a warning when detected.

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('../config');
const rpc = require('./rpc');
const tx = require('./tx');
const routes = require('./routes');
const notify = require('./notify');
const walletStore = require('./wallets');
const { decrypt } = require('./crypto');

const USE_DB = !!(process.env.DATABASE_URL || '').trim();
let neon;
if (USE_DB) {
  try { neon = require('@neondatabase/serverless').neon; } catch { /* file fallback */ }
}
function sql() { return neon(process.env.DATABASE_URL); }

const FILE = path.join(config.dataDir, 'copymint.json');

const ERC721_TRANSFER = ethers.id('Transfer(address,address,uint256)');
const ERC1155_SINGLE = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
const ERC1155_BATCH = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const GAS_LIMIT = 400000n;
const MAX_BLOCKS_PER_SCAN = 25;
const FEED_LIMIT = 80;
const SEEN_TX_LIMIT = 300;

// ── Persistence (Neon or file, same pattern as taskStore) ────────────────────

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await sql()`
    CREATE TABLE IF NOT EXISTS rv3_copymint (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tableReady = true;
}

async function loadTargets() {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      const rows = await sql()`SELECT data FROM rv3_copymint ORDER BY created_at ASC`;
      return rows.map(r => r.data);
    } catch (e) {
      console.error('copymint.loadTargets error:', e.message);
      return [];
    }
  }
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

async function saveTarget(target) {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      await sql()`
        INSERT INTO rv3_copymint (id, data)
        VALUES (${target.id}, ${JSON.stringify(target)})
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
    } catch (e) {
      console.error('copymint.saveTarget error:', e.message);
    }
    return;
  }
  ensureDir();
  let targets = [];
  try { targets = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* fresh file */ }
  const idx = targets.findIndex(t => t.id === target.id);
  if (idx >= 0) targets[idx] = target; else targets.push(target);
  fs.writeFileSync(FILE, JSON.stringify(targets, null, 2));
}

async function deleteTarget(id) {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      await sql()`DELETE FROM rv3_copymint WHERE id = ${id}`;
    } catch (e) {
      console.error('copymint.deleteTarget error:', e.message);
    }
    return;
  }
  ensureDir();
  let targets = [];
  try { targets = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* fresh file */ }
  fs.writeFileSync(FILE, JSON.stringify(targets.filter(t => t.id !== id), null, 2));
}

// ── In-memory runtime state ──────────────────────────────────────────────────

const feed = [];                 // recent detect/replicate events (newest first)
const seenTx = new Set();        // dedupe txHashes we've already acted on
const seenOrder = [];            // FIFO for seenTx eviction
const lastBlockByChain = new Map(); // chainSlug → last scanned block number
let targetsCache = [];           // hydrated on start / add / remove
let watching = false;
let scanning = false;
let timer = null;
let lastScanAt = null;
let lastError = null;

function log(level, message) {
  // Lightweight logger — copymint has no direct store dependency to avoid cycles.
  const line = `[copymint] ${message}`;
  if (level === 'err') console.error(line); else console.log(line);
}

function pushFeed(entry) {
  feed.unshift({ id: `cm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...entry });
  if (feed.length > FEED_LIMIT) feed.length = FEED_LIMIT;
}

function markSeen(txHash) {
  if (seenTx.has(txHash)) return false;
  seenTx.add(txHash);
  seenOrder.push(txHash);
  if (seenOrder.length > SEEN_TX_LIMIT) {
    const evicted = seenOrder.shift();
    seenTx.delete(evicted);
  }
  return true;
}

function addrTopic(address) {
  return '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function toHex(n) { return '0x' + BigInt(n).toString(16); }

// ── Raw JSON-RPC helper (getLogs / getTransactionByHash) ─────────────────────

async function rpcCall(url, method, params, timeout = 6000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

// ── Target management (public API) ───────────────────────────────────────────

function sanitizeTarget(body) {
  const address = String(body.address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Valid 0x wallet address required');

  const gasPreset = body.gasPreset || 'fast';
  let gasGwei = tx.GAS_PRESETS[gasPreset] || tx.GAS_PRESETS.fast;
  if (gasPreset === 'custom') gasGwei = Math.min(Math.max(parseFloat(body.gasGwei) || 15, 1), 999);

  return {
    id: body.id || `cmt_${Date.now()}`,
    address: ethers.getAddress(address),
    label: String(body.label || 'Target').slice(0, 60),
    chainSlug: rpc.normalizeChain(body.chainSlug || 'ethereum'),
    route: routes.normalizeRoute(body.route || routes.ROUTES.DIRECT_RPC),
    walletIds: Array.isArray(body.walletIds) ? body.walletIds.filter(x => typeof x === 'string').slice(0, 50) : [],
    wallets: Math.min(Math.max(parseInt(body.wallets, 10) || 1, 1), 50),
    qty: Math.min(Math.max(parseInt(body.qty, 10) || 1, 1), 10),
    gasPreset,
    gasGwei,
    maxValueEth: body.maxValueEth != null ? Math.max(parseFloat(body.maxValueEth) || 0, 0) : null,
    active: body.active !== false,
    stats: { detected: 0, replicated: 0, lastDetectedAt: null },
    createdAt: new Date().toISOString(),
  };
}

async function addTarget(body) {
  const target = sanitizeTarget(body);
  const existing = targetsCache.find(t => t.address.toLowerCase() === target.address.toLowerCase() && t.chainSlug === target.chainSlug);
  if (existing) throw new Error(`Already watching ${target.address} on ${target.chainSlug}`);
  await saveTarget(target);
  targetsCache.push(target);
  log('info', `watching ${target.label} (${target.address}) on ${target.chainSlug}`);
  ensureWatching();
  return target;
}

async function removeTarget(id) {
  await deleteTarget(id);
  targetsCache = targetsCache.filter(t => t.id !== id);
  return { ok: true };
}

async function toggleTarget(id, active) {
  const t = targetsCache.find(x => x.id === id);
  if (!t) throw new Error('Target not found');
  t.active = active != null ? !!active : !t.active;
  await saveTarget(t);
  ensureWatching();
  return t;
}

function listTargets() {
  return targetsCache.map(t => ({ ...t }));
}

function getFeed() { return feed.slice(0); }

function getStatus() {
  return {
    watching,
    scanning,
    targets: targetsCache.length,
    active: targetsCache.filter(t => t.active).length,
    lastScanAt,
    lastError,
    liveMint: config.enableLiveMint,
    lastBlocks: Object.fromEntries(lastBlockByChain),
  };
}

// ── Detection + replication ──────────────────────────────────────────────────

function pickWallets(wallets, target) {
  const withKeys = wallets.filter(w => w.encryptedKey);
  if (target.walletIds?.length) {
    return withKeys.filter(w => target.walletIds.includes(w.id));
  }
  return withKeys.slice(0, target.wallets || 1);
}

async function replicateMint(target, mint, wallets) {
  const chainSlug = target.chainSlug || 'ethereum';
  const selected = pickWallets(wallets, target);

  if (!config.enableLiveMint) {
    pushFeed({
      type: 'detect', status: 'simulated', targetLabel: target.label, targetAddress: target.address,
      contract: mint.to, chain: chainSlug, mintTxHash: mint.txHash, block: mint.block, std: mint.std,
      note: 'Detected — ENABLE_LIVE_MINT=false (no copy sent)',
    });
    return { sent: 0 };
  }
  if (!selected.length) {
    pushFeed({
      type: 'detect', status: 'skipped', targetLabel: target.label, targetAddress: target.address,
      contract: mint.to, chain: chainSlug, mintTxHash: mint.txHash, block: mint.block, std: mint.std,
      note: 'No wallets with server keys selected for this target',
    });
    return { sent: 0 };
  }

  const sendUrls = tx.pickSendUrls(target.route, [], chainSlug);
  if (!sendUrls.length) {
    pushFeed({
      type: 'detect', status: 'failed', targetLabel: target.label, targetAddress: target.address,
      contract: mint.to, chain: chainSlug, mintTxHash: mint.txHash, block: mint.block,
      note: `No RPC for ${chainSlug} — configure ${chainSlug.toUpperCase()}_RPC_PRIMARY`,
    });
    return { sent: 0 };
  }

  const value = mint.value || 0n;
  if (target.maxValueEth != null && target.maxValueEth >= 0) {
    const capWei = ethers.parseEther(String(target.maxValueEth));
    if (value > capWei) {
      pushFeed({
        type: 'detect', status: 'skipped', targetLabel: target.label, targetAddress: target.address,
        contract: mint.to, chain: chainSlug, mintTxHash: mint.txHash, block: mint.block,
        note: `Mint value ${ethers.formatEther(value)} ETH exceeds cap ${target.maxValueEth} ETH`,
      });
      return { sent: 0 };
    }
  }

  // Detect whether the target address is embedded in calldata (recipient risk).
  const recipientRisk = mint.data && mint.data.toLowerCase().includes(target.address.slice(2).toLowerCase());

  const fastest = await rpc.getFastestUrl(sendUrls);
  const gasGwei = target.gasGwei || tx.GAS_PRESETS.fast;

  const results = await Promise.allSettled(selected.map(async w => {
    const signer = new ethers.Wallet(decrypt(w.encryptedKey));
    const { signed } = await tx.buildAndSign(signer, {
      to: mint.to, data: mint.data, value, gasLimit: GAS_LIMIT,
    }, { rpcUrl: fastest, gasGwei });
    const hash = await tx.broadcastRaw(signed, sendUrls, {
      blast: true, route: routes.normalizeRoute(target.route),
    });
    return { wallet: w.name, walletId: w.id, hash };
  }));

  const replicated = results.map((r, i) => r.status === 'fulfilled'
    ? { wallet: r.value.wallet, hash: r.value.hash, ok: true }
    : { wallet: selected[i]?.name || '?', error: r.reason?.message || String(r.reason), ok: false });
  const sent = replicated.filter(r => r.ok).length;

  pushFeed({
    type: 'replicate',
    status: sent > 0 ? 'copied' : 'failed',
    targetLabel: target.label,
    targetAddress: target.address,
    contract: mint.to,
    chain: chainSlug,
    mintTxHash: mint.txHash,
    block: mint.block,
    std: mint.std,
    valueEth: value > 0n ? ethers.formatEther(value) : '0',
    replicated,
    recipientRisk,
    note: recipientRisk ? 'WARNING: target address found in calldata — copy may mint to target, not you' : null,
  });

  target.stats.replicated += sent;
  saveTarget(target).catch(() => {});

  notify.send(
    `RV3 copy-mint ${sent > 0 ? 'sent' : 'failed'}`,
    `${target.label} minted ${mint.to.slice(0, 10)}… · copied by ${sent}/${selected.length} wallet(s)`,
  ).catch(() => {});

  return { sent };
}

// Fetch the original mint transaction and replicate it.
async function handleDetectedMint(target, contract, txHash, block, std, readUrl, wallets) {
  if (!markSeen(txHash)) return;
  try {
    const original = await rpcCall(readUrl, 'eth_getTransactionByHash', [txHash]);
    if (!original) return;

    // Confirm the target actually SENT this tx (they are the minter/payer).
    if (String(original.from).toLowerCase() !== target.address.toLowerCase()) {
      // Someone else minted TO the target (airdrop/transfer) — not a self-mint. Skip.
      return;
    }

    target.stats.detected += 1;
    target.stats.lastDetectedAt = new Date().toISOString();

    const mint = {
      to: ethers.getAddress(original.to),
      data: original.input || '0x',
      value: BigInt(original.value || '0'),
      txHash,
      block,
      std,
    };
    log('info', `detected ${target.label} mint ${txHash.slice(0, 12)}… (${std}) → replicating`);
    await replicateMint(target, mint, wallets);
  } catch (e) {
    lastError = e.message;
    log('err', `handleDetectedMint ${txHash.slice(0, 12)}…: ${e.message}`);
  }
}

async function scanChain(chainSlug, targets, wallets) {
  const urls = rpc.allRpcUrls([], chainSlug);
  if (!urls.length) return;
  const readUrl = await rpc.getFastestUrl(urls).catch(() => urls[0]);

  const head = Number(await rpcCall(readUrl, 'eth_blockNumber', []).then(h => parseInt(h, 16)));
  if (!head) return;

  let from = lastBlockByChain.get(chainSlug);
  if (from == null) from = head - 1;              // first run: only look 1 block back
  from = Math.max(from + 1, head - MAX_BLOCKS_PER_SCAN);
  const to = head;
  if (from > to) { lastBlockByChain.set(chainSlug, to); return; }

  const targetsByTopic = new Map(); // addrTopic → target
  for (const t of targets) targetsByTopic.set(addrTopic(t.address), t);
  const topicList = [...targetsByTopic.keys()];

  const fromHex = toHex(from);
  const toHexStr = toHex(to);

  // ERC-721: Transfer(from=0x0, to=<targets>) — recipient is topic[2].
  // ERC-1155 single: TransferSingle(operator, from=0x0, to=<targets>) — recipient is topic[3].
  const [erc721Logs, erc1155Logs] = await Promise.all([
    rpcCall(readUrl, 'eth_getLogs', [{
      fromBlock: fromHex, toBlock: toHexStr, topics: [ERC721_TRANSFER, ZERO_TOPIC, topicList],
    }]).catch(() => []),
    rpcCall(readUrl, 'eth_getLogs', [{
      fromBlock: fromHex, toBlock: toHexStr, topics: [ERC1155_SINGLE, null, ZERO_TOPIC, topicList],
    }]).catch(() => []),
  ]);

  lastBlockByChain.set(chainSlug, to);

  const jobs = [];
  for (const lg of erc721Logs || []) {
    const t = targetsByTopic.get((lg.topics[2] || '').toLowerCase());
    if (t) jobs.push(handleDetectedMint(t, lg.address, lg.transactionHash, parseInt(lg.blockNumber, 16), 'ERC-721', readUrl, wallets));
  }
  for (const lg of erc1155Logs || []) {
    const t = targetsByTopic.get((lg.topics[3] || '').toLowerCase());
    if (t) jobs.push(handleDetectedMint(t, lg.address, lg.transactionHash, parseInt(lg.blockNumber, 16), 'ERC-1155', readUrl, wallets));
  }
  await Promise.allSettled(jobs);
}

async function scanOnce() {
  if (scanning) return;
  scanning = true;
  lastScanAt = new Date().toISOString();
  try {
    const active = targetsCache.filter(t => t.active);
    if (!active.length) return;

    const wallets = await walletStore.loadWallets().catch(() => []);
    const byChain = new Map();
    for (const t of active) {
      const c = t.chainSlug || 'ethereum';
      if (!byChain.has(c)) byChain.set(c, []);
      byChain.get(c).push(t);
    }
    await Promise.allSettled([...byChain.entries()].map(([chain, ts]) => scanChain(chain, ts, wallets)));
    lastError = null;
  } catch (e) {
    lastError = e.message;
    log('err', `scanOnce: ${e.message}`);
  } finally {
    scanning = false;
  }
}

// ── Watcher lifecycle ────────────────────────────────────────────────────────

function ensureWatching() {
  const shouldWatch = targetsCache.some(t => t.active);
  if (shouldWatch && !watching) startWatching();
  else if (!shouldWatch && watching) stopWatching();
}

function startWatching() {
  if (watching) return;
  if (!rpc.allRpcUrls().length) {
    log('info', 'watcher not started — no RPC endpoints configured');
    return;
  }
  watching = true;
  const interval = config.copymintScanMs || 4000;
  timer = setInterval(() => { scanOnce().catch(() => {}); }, interval);
  if (timer.unref) timer.unref();
  log('info', `watcher online — scanning every ${interval}ms`);
}

function stopWatching() {
  if (timer) { clearInterval(timer); timer = null; }
  watching = false;
  log('info', 'watcher stopped');
}

async function start() {
  try {
    targetsCache = await loadTargets();
  } catch (e) {
    targetsCache = [];
    log('err', `start/loadTargets: ${e.message}`);
  }
  // hydrate stats defaults for older records
  for (const t of targetsCache) {
    if (!t.stats) t.stats = { detected: 0, replicated: 0, lastDetectedAt: null };
  }
  ensureWatching();
}

module.exports = {
  start,
  scanOnce,
  startWatching,
  stopWatching,
  addTarget,
  removeTarget,
  toggleTarget,
  listTargets,
  getFeed,
  getStatus,
  loadTargets,
  saveTarget,
  deleteTarget,
};
