'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const store = require('../store');
const detector = require('../services/detector');
const eligibility = require('../services/eligibility');
const rpc = require('../services/rpc');
const prices = require('../services/prices');
const notify = require('../services/notify');
const worker = require('../services/worker');
const pnl = require('../services/pnl');
const tx = require('../services/tx');
const { encrypt, addressFromKey } = require('../services/crypto');
const walletStore = require('../services/wallets');
const prewarm = require('../services/prewarm');
const taskStore = require('../services/taskStore');
const mint = require('../services/mint');

const router = express.Router();

const taskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.taskRateLimit,
  message: { error: `Rate limit: max ${config.taskRateLimit} tasks per minute` },
});

function state() { return worker.getState(); }

router.get('/health', (req, res) => {
  const s = state();
  const queued = s.tasks.filter(t => t.status === 'queued').length
    + (s.fundOps || []).filter(o => o.status === 'queued').length
    + (s.sweepOps || []).filter(o => o.status === 'queued').length;
  res.json({
    ok: true,
    worker: 'online',
    queuedTasks: queued,
    wallets: s.wallets.length,
    history: s.history.length,
    services: {
      opensea: !!config.openseaApiKey,
      etherscan: !!config.etherscanApiKey,
      blur: !!config.blurApiKey,
      rpc: config.envRpcs.length,
      discord: !!config.discordWebhook,
      telegram: !!(config.telegramToken && config.telegramChatId),
      walletEncryption: config.hasWalletEncryption,
      liveMint: config.enableLiveMint,
    },
    version: '2.0.0',
  });
});

router.get('/settings/status', (req, res) => {
  res.json({
    services: {
      opensea: { configured: !!config.openseaApiKey, label: 'OpenSea API' },
      etherscan: { configured: !!config.etherscanApiKey, label: 'Etherscan API' },
      blur: { configured: !!config.blurApiKey, label: 'Blur API' },
      rpc: { configured: config.envRpcs.length > 0, count: config.envRpcs.length, label: 'Env RPC endpoints' },
      flashbots: { configured: !!config.flashbotsAuthKey, label: 'Flashbots auth key' },
      discord: { configured: !!config.discordWebhook, label: 'Discord webhook' },
      telegram: { configured: !!(config.telegramToken && config.telegramChatId), label: 'Telegram bot' },
      walletEncryption: { configured: config.hasWalletEncryption, label: 'Wallet encryption' },
      liveMint: { enabled: config.enableLiveMint, label: 'Live mint execution' },
    },
  });
});

router.get('/price/eth', async (req, res) => {
  try {
    const usd = await prices.getEthUsd();
    res.json({ usd });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/gas', async (req, res) => {
  try {
    const urls = rpc.allRpcUrls();
    if (!urls.length) return res.json({ gwei: null, usd: null });
    const [gwei, ethUsd] = await Promise.all([rpc.getGasPrice(urls[0]), prices.getEthUsd()]);
    const usdPer100k = (gwei * 100000 / 1e9) * ethUsd;
    res.json({ gwei, ethUsd, usdPer100k: Math.round(usdPer100k * 100) / 100 });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/detect', async (req, res) => {
  try {
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ error: 'input required' });
    const s = state();
    const checkWallets = req.body?.checkEligibility !== false;
    const wallets = checkWallets
      ? s.wallets.filter(w => w.address || /^0x[a-fA-F0-9]{40}$/.test(String(w.addr || '')))
      : [];
    const result = await detector.detect(input, { wallets });
    res.json({ result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/detect/eligibility', async (req, res) => {
  try {
    const slug = String(req.body?.openseaSlug || req.body?.slug || '').trim();
    const phaseUuid = req.body?.phaseUuid != null ? String(req.body.phaseUuid) : null;
    const phaseIndex = Number.isInteger(req.body?.phaseIndex) ? req.body.phaseIndex : null;
    const phasePayload = req.body?.phase;

    if (!slug) return res.status(400).json({ error: 'openseaSlug required' });

    let phase = phasePayload;
    if (!phase) {
      const { phases: parsed } = await detector.fetchDropPhases(slug);
      if (!parsed?.length) return res.status(404).json({ error: 'No drop phases found' });
      if (phaseUuid) phase = parsed.find(p => p.uuid === phaseUuid);
      else if (phaseIndex != null) phase = parsed[phaseIndex];
      else phase = parsed.find(p => p.status === 'live') || parsed[0];
      if (!phase) return res.status(404).json({ error: 'Phase not found' });
    }

    const s = state();
    const walletIds = Array.isArray(req.body?.walletIds) ? req.body.walletIds : null;
    const wallets = walletIds?.length
      ? s.wallets.filter(w => walletIds.includes(w.id))
      : s.wallets;

    const result = await eligibility.checkWalletsForPhase(slug, phase, wallets);
    res.json({ result, phase });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/rpc/env', (req, res) => {
  res.json({
    rpcs: config.envRpcs.map(r => ({
      id: r.id,
      name: r.name || r.id,
      role: r.role,
      url: rpc.maskUrl(r.url),
      urlFull: r.url,
      fromEnv: true,
    })),
  });
});

router.post('/rpc/ping', async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    const fallbackUrl = String(req.body?.url || '').trim();

    if (id) {
      const envRpc = config.envRpcs.find(r => r.id === id);
      const pingUrl = envRpc?.url || (fallbackUrl.startsWith('https://') ? fallbackUrl : null);
      if (!pingUrl) return res.status(404).json({ error: 'RPC not found — set ETH_RPC_PRIMARY in env vars' });
      const ms = await rpc.ping(pingUrl);
      return res.json({ ms, ok: true });
    }

    const url = fallbackUrl;
    if (!url.startsWith('https://')) return res.status(400).json({ error: 'HTTPS URL required' });
    const ms = await rpc.ping(url);
    res.json({ ms, ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message, ok: false });
  }
});

router.get('/wallets', async (req, res) => {
  try {
    const wallets = await walletStore.loadWallets();
    // keep in-memory state in sync
    state().wallets = wallets;
    res.json({
      wallets: wallets.map(w => ({
        id: w.id, name: w.name, addr: w.addr, address: w.address,
        eth: w.eth || 0, chain: w.chain || 'ETH', low: !!w.low,
        hasKey: !!w.encryptedKey,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wallets/refresh', async (req, res) => {
  try {
    const wallets = await walletStore.loadWallets();
    state().wallets = wallets;
    const urls = rpc.allRpcUrls();
    if (urls.length) {
      await Promise.allSettled(wallets.map(async w => {
        if (!w.address) return;
        try {
          const eth = await rpc.getBalance(urls[0], w.address);
          w.eth = eth;
          w.low = eth < 0.01;
          await walletStore.updateBalance(w.id, eth);
        } catch { /* keep last */ }
      }));
    }
    res.json({ wallets: wallets.map(w => ({ id: w.id, eth: w.eth, low: w.low })) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/wallets/preview', async (req, res) => {
  try {
    let key = String(req.body?.privateKey || '').trim();
    if (!key) return res.status(400).json({ error: 'privateKey required' });
    if (!key.startsWith('0x')) key = `0x${key}`;
    const address = addressFromKey(key);
    if (!address) return res.status(400).json({ error: 'Invalid private key' });
    const urls = rpc.allRpcUrls();
    let eth = 0;
    if (urls.length) {
      try { eth = await rpc.getBalance(urls[0], address); } catch { /* balance optional */ }
    }
    res.json({ address, eth });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/wallets/import', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    let key = String(req.body?.privateKey || '').trim();
    const bal = parseFloat(req.body?.balance) || 0;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!key) return res.status(400).json({ error: 'privateKey required' });
    if (!key.startsWith('0x')) key = `0x${key}`;
    const address = addressFromKey(key);
    if (!address) return res.status(400).json({ error: 'Invalid private key' });
    if (!config.hasWalletEncryption) {
      return res.status(400).json({
        error: 'Set WALLET_ENCRYPTION_KEY in .env (64-char hex) before importing keys server-side',
      });
    }

    const entry = {
      id: `w_${Date.now()}`,
      name,
      address,
      addr: `${address.slice(0, 8)}...${address.slice(-6)}`,
      eth: bal,
      chain: 'ETH',
      low: bal < 0.01,
      nonce: 0,
      encryptedKey: encrypt(key),
      createdAt: new Date().toISOString(),
    };

    await walletStore.saveWallet(entry);
    // keep in-memory state in sync
    const s = state();
    const existing = s.wallets.find(w => w.id === entry.id);
    if (!existing) s.wallets.push(entry);

    res.json({ wallet: { id: entry.id, name: entry.name, addr: entry.addr, address: entry.address, eth: entry.eth } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/wallets/:id', async (req, res) => {
  try {
    await walletStore.deleteWallet(req.params.id);
    const s = state();
    s.wallets = s.wallets.filter(w => w.id !== req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wallets/batch-delete', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => typeof id === 'string') : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    await Promise.all(ids.map(id => walletStore.deleteWallet(id)));
    const s = state();
    s.wallets = s.wallets.filter(w => !ids.includes(w.id));
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const persisted = await taskStore.loadTasks();
    // Merge with in-memory (in-memory wins for running tasks)
    const s = state();
    for (const t of persisted) {
      if (!s.tasks.find(x => x.id === t.id)) s.tasks.unshift(t);
    }
    res.json({ tasks: s.tasks });
  } catch {
    res.json({ tasks: state().tasks });
  }
});

async function resolveTask(id, bodyTask) {
  // 1. in-memory
  let task = state().tasks.find(t => t.id === id);
  if (task) return task;
  // 2. Neon / file
  task = await taskStore.getTask(id);
  if (task) { state().tasks.unshift(task); return task; }
  // 3. caller passed the full task object (frontend fallback)
  if (bodyTask?.id === id) { state().tasks.unshift(bodyTask); return bodyTask; }
  return null;
}

router.post('/tasks', taskLimiter, async (req, res) => {
  const body = req.body || {};
  const s = state();
  const gasPreset = body.gasPreset || 'normal';
  let gasGwei = tx.GAS_PRESETS[gasPreset] || 25;
  if (gasPreset === 'custom') gasGwei = Math.min(Math.max(parseFloat(body.gasGwei) || 25, 1), 999);

  const task = {
    id: `task_${Date.now()}`,
    drop: String(body.drop || 'Unknown').slice(0, 120),
    dropId: String(body.dropId || '').slice(0, 64),
    openseaSlug: String(body.openseaSlug || '').slice(0, 120) || null,
    contractAddress: String(body.contractAddress || '').slice(0, 66) || null,
    chainSlug: String(body.chainSlug || 'ethereum').slice(0, 20),
    route: String(body.route || 'DIRECT RPC').slice(0, 40),
    wallets: Math.min(Math.max(parseInt(body.wallets, 10) || 1, 1), 50),
    qty: Math.min(Math.max(parseInt(body.qty, 10) || 1, 1), 10),
    name: String(body.name || body.drop || 'Task').slice(0, 120),
    status: 'queued',
    time: new Date().toLocaleString(),
    scheduledFor: body.scheduledFor || null,
    scheduledAt: body.scheduledAt || null,
    gasPreset,
    gasGwei,
    rpcBlast: body.rpcBlast !== false,
    rpcCount: body.rpcCount || config.envRpcs.length,
    rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
    createdAt: new Date().toISOString(),
  };

  s.tasks.unshift(task);
  store.appendLog(s, 'info', `Task queued: ${task.name}`);
  worker.save();

  // Persist to Neon so any Lambda can find it
  taskStore.saveTask(task).catch(() => {});

  // Pre-warm immediately (non-blocking)
  if (task.openseaSlug) {
    const wallets = await walletStore.loadWallets().catch(() => s.wallets);
    const log = (level, msg) => store.appendLog(s, level, msg);
    setImmediate(() => prewarm.prewarmTask(task, wallets, log).catch(() => {}));
  }

  res.json({ task });
});

router.post('/tasks/:id/prewarm', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.openseaSlug) return res.status(400).json({ error: 'No OpenSea slug on task' });
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);
    const log = (level, msg) => store.appendLog(state(), level, msg);
    await prewarm.prewarmTask(task, wallets, log);
    const warmed = wallets
      .filter(w => w.encryptedKey).slice(0, task.wallets || 1)
      .filter(w => prewarm.isReady(task.id, w.id)).length;
    res.json({ ok: true, warmed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/run', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'queued') return res.status(400).json({ error: `Task is ${task.status}` });

    // Load wallets from Neon so this works on any Lambda
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);

    // Mark running immediately
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    await taskStore.updateTaskStatus(task.id, 'running', { startedAt: task.startedAt });

    // Respond immediately so the UI shows "running" — then execute
    res.json({ ok: true, status: 'running' });

    // Execute synchronously in this Lambda (Vercel allows up to 300s on Pro)
    const log = (level, msg) => store.appendLog(state(), level, msg);
    try {
      if (!config.enableLiveMint) {
        task.status = 'completed';
        task.note = 'Preflight only — set ENABLE_LIVE_MINT=true';
        await taskStore.updateTaskStatus(task.id, 'completed', { note: task.note });
        return;
      }
      if (!task.openseaSlug) throw new Error('Missing openseaSlug');

      // Pre-warm if not already done
      const cached = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1)
        .every(w => prewarm.isReady(task.id, w.id));
      if (!cached) await prewarm.prewarmTask(task, wallets, log);

      const result = await mint.runMintTask(task, wallets, log);
      // "broadcast" = tx in mempool (got hash); "failed" = no hash at all
      task.status = result.txHashes.length > 0 ? 'broadcast' : 'failed';
      task.minted = result.minted;
      task.txHashes = result.txHashes;
      task.avgBroadcastMs = result.avgBroadcastMs;
      task.error = result.errors.length ? result.errors.join('; ') : null;
      task.finishedAt = new Date().toISOString();
      await taskStore.updateTaskStatus(task.id, task.status, {
        minted: task.minted, txHashes: task.txHashes,
        avgBroadcastMs: task.avgBroadcastMs, error: task.error,
        finishedAt: task.finishedAt,
      });
      const note = result.txHashes.length
        ? `${result.txHashes.length} tx(s) broadcast in ${result.avgBroadcastMs}ms`
        : (task.error || 'no txs');
      notify.send(`RV3 mint ${task.status}`, `${task.drop} · ${note}`).catch(() => {});
    } catch (e) {
      task.status = 'failed';
      task.error = e.message;
      task.finishedAt = new Date().toISOString();
      await taskStore.updateTaskStatus(task.id, 'failed', { error: e.message, finishedAt: task.finishedAt });
      log('err', e.message);
      notify.send('RV3 mint failed', `${task.drop} · ${e.message}`).catch(() => {});
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/priority', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    task.priority = true;
    await taskStore.updateTaskStatus(task.id, task.status, { priority: true });
    worker.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  const s = state();
  s.tasks = s.tasks.filter(t => t.id !== req.params.id);
  prewarm.clearTask(req.params.id);
  await taskStore.deleteTask(req.params.id).catch(() => {});
  worker.save();
  res.json({ ok: true });
});

router.post('/fund', taskLimiter, (req, res) => {
  const body = req.body || {};
  const s = state();
  const gasPreset = body.gasPreset || 'normal';
  let gasGwei = tx.GAS_PRESETS[gasPreset] || 25;
  const op = {
    id: `fund_${Date.now()}`,
    op: String(body.op || 'distribute').slice(0, 20),
    hubId: String(body.hubId || ''),
    sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.slice(0, 50) : [],
    amountEth: parseFloat(body.amountEth) || 0,
    gasGwei,
    status: 'queued',
    time: new Date().toLocaleString(),
    rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
  };
  if (!op.hubId) return res.status(400).json({ error: 'hubId required' });
  if (!op.sourceIds.length) return res.status(400).json({ error: 'sourceIds required' });
  s.fundOps = s.fundOps || [];
  s.fundOps.unshift(op);
  store.appendLog(s, 'info', `Fund queued: ${op.op}`);
  worker.save();
  res.json({ op });
});

router.post('/sweep', taskLimiter, (req, res) => {
  const body = req.body || {};
  const s = state();
  const op = {
    id: `sweep_${Date.now()}`,
    hubId: String(body.hubId || ''),
    sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.slice(0, 50) : [],
    collection: body.collection ? String(body.collection).slice(0, 200) : null,
    chain: String(body.chain || 'ethereum').slice(0, 20),
    gasGwei: tx.GAS_PRESETS[body.gasPreset] || tx.GAS_PRESETS.normal,
    status: 'queued',
    time: new Date().toLocaleString(),
    rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
  };
  if (!op.hubId) return res.status(400).json({ error: 'hubId required' });
  if (!op.sourceIds.length) return res.status(400).json({ error: 'sourceIds required' });
  s.sweepOps = s.sweepOps || [];
  s.sweepOps.unshift(op);
  store.appendLog(s, 'info', 'NFT sweep queued');
  worker.save();
  res.json({ op });
});

router.get('/fund', (req, res) => {
  res.json({ ops: state().fundOps || [] });
});

router.get('/sweep', (req, res) => {
  res.json({ ops: state().sweepOps || [] });
});

router.get('/history', (req, res) => {
  res.json({ history: state().history, logs: (state().logs || []).slice(0, 100) });
});

router.get('/pnl', async (req, res) => {
  try {
    const enriched = await pnl.enrichHistory(state().history.filter(h => h.type === 'mint' || !h.type));
    const ethUsd = await prices.getEthUsd();
    const totalGas = enriched.reduce((s, r) => s + (r.gasCostUsd || 0), 0);
    const totalMinted = enriched.reduce((s, r) => s + (r.minted || 0), 0);
    res.json({ runs: enriched, summary: { totalGasUsd: totalGas, totalMinted, ethUsd } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/notify/test', async (req, res) => {
  try {
    const r = await notify.send('RV3 test notification', 'If you see this, alerts are working.');
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
