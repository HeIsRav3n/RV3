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
const walletStore = require('../services/wallets');
const prewarm = require('../services/prewarm');
const taskStore = require('../services/taskStore');
const routes = require('../services/routes');
const mint = require('../services/mint');
const receipt = require('../services/receipt');
const gql = require('../services/gql');
const copymint = require('../services/copymint');
const delegation = require('../services/delegation');
const productionPolicy = require('../services/productionPolicy');
const policyStore = require('../services/policyStore');
const theGraph = require('../services/theGraph');
const readiness = require('../services/readiness');
const db = require('../db');
const walletConnectSigner = require('../services/walletConnectSigner');

const router = express.Router();

const taskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.taskRateLimit,
  message: { error: `Rate limit: max ${config.taskRateLimit} tasks per minute` },
});

function state() { return worker.getState(); }

function appendTaskEvent(task, type, detail) {
  task.events = Array.isArray(task.events) ? task.events : [];
  task.events.push({ at: new Date().toISOString(), type, detail: String(detail || '').slice(0, 300) });
  task.events = task.events.slice(-100);
}

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
      builders: config.builderRpcs.length,
      discord: !!config.discordWebhook,
      telegram: !!(config.telegramToken && config.telegramChatId),
      signerProvider: walletConnectSigner.status().connected,
      liveMint: config.enableLiveMint,
      database: db.useDatabase(),
      eventProvider: !!config.eventProvider,
      theGraphEthereum: !!theGraph.endpoint('ethereum'),
      theGraphRobinhood: !!theGraph.endpoint('robinhood'),
      walletConnect: walletConnectSigner.configured(),
    },
    version: require('../../package.json').version,
  });
});

router.get('/settings/status', (req, res) => {
  res.json({
    services: {
      opensea: { configured: !!config.openseaApiKey, label: 'OpenSea API' },
      etherscan: { configured: !!config.etherscanApiKey, label: 'Etherscan API' },
      blur: { configured: !!config.blurApiKey, label: 'Blur API' },
      rpc: { configured: config.envRpcs.length > 0, count: config.envRpcs.length, label: 'Env RPC endpoints' },
      builders: { configured: config.builderRpcs.length, count: config.builderRpcs.length, label: 'Builder endpoints' },
      flashbots: { configured: false, label: 'Flashbots signing disabled' },
      discord: { configured: !!config.discordWebhook, label: 'Discord webhook' },
      telegram: { configured: !!(config.telegramToken && config.telegramChatId), label: 'Telegram bot' },
      signerProvider: { configured: walletConnectSigner.status().connected, label: 'External signer provider' },
      liveMint: { enabled: config.enableLiveMint, label: 'Live mint execution' },
      database: { configured: db.useDatabase(), label: 'Durable PostgreSQL policy store' },
      eventProvider: { configured: !!config.eventProvider, label: 'Read-only event provider' },
      theGraphEthereum: { configured: !!theGraph.endpoint('ethereum'), label: 'The Graph · Ethereum' },
      theGraphRobinhood: { configured: !!theGraph.endpoint('robinhood'), label: 'The Graph · Robinhood Chain' },
      walletConnect: { configured: walletConnectSigner.configured(), label: 'WalletConnect external signer' },
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
    const chain = rpc.normalizeChain(req.query.chain || 'ethereum');
    const urls = rpc.allRpcUrls([], chain);
    if (!urls.length) return res.json({ gwei: null, usd: null, chain });
    const [gwei, ethUsd] = await Promise.all([rpc.getGasPrice(urls[0]), prices.getEthUsd()]);
    const usdPer100k = (gwei * 100000 / 1e9) * ethUsd;
    res.json({ gwei, ethUsd, usdPer100k: Math.round(usdPer100k * 100) / 100, chain });
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
      chain: r.chain || 'ethereum',
      url: rpc.maskUrl(r.url),
      fromEnv: true,
    })),
  });
});

router.post('/rpc/ping', async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Configured RPC ID required.' });
    const envRpc = config.envRpcs.find(r => r.id === id);
    if (!envRpc) return res.status(404).json({ error: 'Configured RPC not found.' });
    const ms = await rpc.ping(envRpc.url);
    res.json({ ms, ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message, ok: false });
  }
});

router.get('/diag/opensea', async (req, res) => {
  try {
    if (!config.openseaGraphqlEnabled) {
      return res.json({ graphql: 'disabled', recommendation: 'Use OpenSea REST v2 diagnostics and rate-limit headers.' });
    }
    const n = Math.min(Math.max(parseInt(req.query.n || '5', 10), 1), 20);
    const stats = await gql.probeStats(n);
    res.json(stats);
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
        signerType: w.signerType || 'external',
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

// Live per-chain balances (not persisted) — lets the UI show what each wallet
// holds on Robinhood, Base, etc. without clobbering the stored ETH balance.
router.post('/wallets/balances', async (req, res) => {
  try {
    const chain = rpc.normalizeChain(req.body?.chain || 'ethereum');
    const urls = rpc.allRpcUrls([], chain);
    if (!urls.length) return res.status(400).json({ error: `No RPC configured for ${chain}` });
    const url = await rpc.getFastestUrl(urls);
    const wallets = state().wallets.filter(w => w.address);
    const balances = await Promise.all(wallets.map(async w => {
      try {
        const eth = await rpc.getBalance(url, w.address);
        return { id: w.id, address: w.address, eth };
      } catch {
        return { id: w.id, address: w.address, eth: null };
      }
    }));
    res.json({ chain, balances });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/wallets/preview', (req, res) => {
  res.status(410).json({ error: 'Private-key preview is permanently disabled. Add a watch-only external signer address instead.' });
});

router.get('/signer/walletconnect/status', (req, res) => {
  res.json(walletConnectSigner.status());
});

router.post('/signer/walletconnect/pair', async (req, res) => {
  try { res.json(await walletConnectSigner.beginPairing()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/worker/status', (req, res) => {
  res.json({ worker: worker.getStatus(), copyMint: copymint.getStatus(), liveReadiness: {
      signerConfigured: walletConnectSigner.status().connected,
      eventProviderConfigured: !!config.eventProvider,
    durableDatabaseConfigured: !!process.env.DATABASE_URL,
    liveExecutionEnabled: config.enableLiveMint,
    message: 'Live execution remains blocked until a selected external signer and durable policy store are configured.',
  } });
});

router.get('/opensea/status', async (req, res) => {
  if (!config.openseaApiKey) return res.json({ configured: false, rest: 'unavailable', graphql: config.openseaGraphqlEnabled ? 'diagnostic-only' : 'disabled' });
  try {
    const chains = await opensea.getSupportedChains();
    res.json({ configured: true, rest: 'ok', graphql: config.openseaGraphqlEnabled ? 'diagnostic-only' : 'disabled', chains: chains.map(c => c.identifier || c.chain || c.name).filter(Boolean) });
  } catch (e) {
    res.status(502).json({ configured: true, rest: 'unavailable', error: e.message });
  }
});

router.get('/thegraph/status', async (req, res) => {
  const chains = ['ethereum', 'robinhood'];
  const checks = await Promise.all(chains.map(async chain => {
    try { return await theGraph.health(chain); }
    catch { return { configured: true, chain, mode: 'unavailable' }; }
  }));
  res.json({ checks, role: 'indexed_read_model_only', realtime: 'Use approved RPC or event provider for FCFS triggering.' });
});

router.get('/portfolio', async (req, res) => {
  try {
    const wallets = await walletStore.loadWallets();
    const chain = rpc.normalizeChain(req.query.chain || 'ethereum');
    const urls = rpc.allRpcUrls([], chain);
    if (!urls.length) return res.json({ chain, wallets: [], total: 0, fundingPlan: [] });
    const url = await rpc.getFastestUrl(urls);
    const balances = await Promise.all(wallets.map(async wallet => {
      try { return { ...wallet, balance: await rpc.getBalance(url, wallet.address), available: true }; }
      catch { return { ...wallet, balance: null, available: false }; }
    }));
    const total = balances.reduce((sum, w) => sum + (w.balance || 0), 0);
    const minBalance = Math.min(Math.max(Number(req.query.minBalance || 0.02), 0), 1000);
    const fundingPlan = balances.filter(w => w.balance != null && w.balance < minBalance)
      .map(w => ({ walletId: w.id, address: w.address, shortfall: Math.max(0, minBalance - w.balance) }));
    res.json({ chain, wallets: balances, total, minBalance, fundingPlan });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/networks', (req, res) => {
  res.json({ networks: Object.entries(readiness.CHAINS).map(([slug, network]) => ({
    slug, ...network, approvedRpcCount: rpc.allRpcUrls([], slug).length,
  })) });
});

router.get('/rpc/health', async (req, res) => {
  const chain = rpc.normalizeChain(req.query.chain || 'ethereum');
  const urls = rpc.allRpcUrls([], chain);
  const endpoints = await Promise.all(urls.map(async url => {
    try { return { url: rpc.maskUrl(url), ok: true, ms: await rpc.ping(url) }; }
    catch { return { url: rpc.maskUrl(url), ok: false, error: 'unavailable' }; }
  }));
  res.json({ chain, endpoints, healthy: endpoints.filter(r => r.ok).length });
});

router.post('/wallets/import', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const bal = parseFloat(req.body?.balance) || 0;
    const address = String(req.body?.address || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (req.body?.privateKey != null || req.body?.encryptedKey != null) return res.status(400).json({ error: 'Private keys are not accepted by RV3.' });
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'A valid external signer address is required.' });

    const entry = {
      id: `w_${Date.now()}`,
      name,
      address,
      addr: `${address.slice(0, 8)}...${address.slice(-6)}`,
      eth: bal,
      chain: 'ETH',
      low: bal < 0.01,
      nonce: 0,
      signerType: 'external',
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
  let validated;
  try { validated = readiness.validateTaskInput(body); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const gasPreset = body.gasPreset || 'normal';
  let gasGwei = tx.GAS_PRESETS[gasPreset] || 25;
  if (gasPreset === 'custom') gasGwei = Math.min(Math.max(parseFloat(body.gasGwei) || 25, 1), 999);

  const task = {
    id: `task_${Date.now()}`,
    drop: String(body.drop || 'Unknown').slice(0, 120),
    dropId: String(body.dropId || '').slice(0, 64),
    openseaSlug: String(body.openseaSlug || '').slice(0, 120) || null,
    contractAddress: validated.contractAddress,
    chainSlug: validated.chainSlug,
    route: routes.normalizeRoute(body.route || routes.ROUTES.DIRECT_RPC),
    wallets: Math.min(Math.max(parseInt(body.wallets, 10) || 1, 1), 50),
    qty: Math.min(Math.max(parseInt(body.qty, 10) || 1, 1), 10),
    name: String(body.name || body.drop || 'Task').slice(0, 120),
    status: 'queued',
    time: new Date().toLocaleString(),
    scheduledFor: validated.scheduledAt,
    scheduledAt: validated.scheduledAt,
    gasPreset,
    gasGwei,
    rpcBlast: body.rpcBlast !== false,
    rpcPrewarm: body.rpcPrewarm !== false,
    targetBlock: validated.targetBlock,
    rpcCount: body.rpcCount || config.envRpcs.length,
    rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
    createdAt: new Date().toISOString(),
    executionApproved: false,
    events: [],
  };
  appendTaskEvent(task, 'created', `Queued for ${task.chainSlug} in ${task.targetBlock ? `block ${task.targetBlock}` : task.scheduledAt || 'manual mode'}`);

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

router.get('/tasks/:id/readiness', async (req, res) => {
  const task = await resolveTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const wallets = await walletStore.loadWallets().catch(() => state().wallets);
  res.json(readiness.summary(task, wallets));
});

router.post('/tasks/:id/confirm', async (req, res) => {
  const task = await resolveTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'queued') return res.status(400).json({ error: `Task is ${task.status}` });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Set confirm: true to record explicit operator approval' });
  task.executionApproved = true;
  task.approvedAt = new Date().toISOString();
  appendTaskEvent(task, 'operator_confirmed', 'Explicit confirmation recorded; external signer approval is still required.');
  await taskStore.saveTask(task);
  worker.save();
  res.json({ ok: true, task });
});

router.post('/tasks/:id/prewarm', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.openseaSlug) return res.status(400).json({ error: 'No OpenSea slug on task' });
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);
    const log = (level, msg) => store.appendLog(state(), level, msg);
    const result = await prewarm.prewarmTask(task, wallets, log);
    const warmed = result?.warmed ?? 0;
    task.warmed = warmed;
    task.prewarmedAt = new Date().toISOString();
    await taskStore.updateTaskStatus(task.id, task.status, { warmed, prewarmedAt: task.prewarmedAt });
    worker.save();
    res.json({ ok: true, warmed, wallets: result?.wallets || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function preflightTaskRow(task, wallets) {
  const chain = rpc.normalizeChain(task.chainSlug || 'ethereum');
  const urls = rpc.allRpcUrls(task.rpcUrls || [], chain);
  const warm = prewarm.taskWarmStatus(task, wallets);
  const need = warm.length || task.wallets || 1;
  const signerCount = wallets.filter(w => w.signerType === 'external').length;
  return {
    id: task.id,
    name: task.name || task.drop,
    drop: task.drop,
    status: task.status,
    chainSlug: chain,
    route: task.route,
    wallets: need,
    slug: !!task.openseaSlug,
    rpcOk: urls.length > 0,
    rpcCount: urls.length,
    externalSignerReady: false,
    warmed: warm.filter(w => w.ok).length,
    warm,
    ready: false,
  };
}

router.get('/preflight', async (req, res) => {
  try {
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);
    const queued = state().tasks.filter(t => t.status === 'queued');
    const chains = [...new Set(queued.map(t => rpc.normalizeChain(t.chainSlug || 'ethereum')))];
    if (!chains.length) chains.push('ethereum');
    res.json({
      liveMint: !!config.enableLiveMint,
      tasks: queued.map(t => preflightTaskRow(t, wallets)),
      chains: chains.map(chain => ({
        chain,
        rpc: rpc.allRpcUrls([], chain).length,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/preflight', taskLimiter, async (req, res) => {
  try {
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);
    const queued = state().tasks.filter(t => t.status === 'queued');
    const log = (level, msg) => store.appendLog(state(), level, msg);
    const results = [];
    for (const task of queued) {
      if (!task.openseaSlug) {
        results.push({ id: task.id, error: 'No OpenSea slug', warmed: 0, wallets: [] });
        continue;
      }
      const result = await prewarm.prewarmTask(task, wallets, log);
      task.warmed = result.warmed;
      task.prewarmedAt = new Date().toISOString();
      await taskStore.updateTaskStatus(task.id, task.status, { warmed: task.warmed, prewarmedAt: task.prewarmedAt }).catch(() => {});
      results.push({ id: task.id, ...result, row: preflightTaskRow(task, wallets) });
    }
    worker.save();
    res.json({ results, tasks: queued.map(t => preflightTaskRow(t, wallets)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/run', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'queued') return res.status(400).json({ error: `Task is ${task.status}` });
    const policy = productionPolicy.readPolicy();
    let reservation = null;

    // Load wallets from Neon so this works on any Lambda
    const wallets = await walletStore.loadWallets().catch(() => state().wallets);

    if (config.enableLiveMint) {
      if (task.executionApproved !== true) return res.status(409).json({ error: 'Explicit operator confirmation is required before live execution.' });
      productionPolicy.assertLiveReady(policy);
      productionPolicy.assertTaskAllowed(task, policy);
      productionPolicy.assertSignatureRequest(req.body?.signatureRequest, policy);
      reservation = await policyStore.reserve({
        approvalId: req.body.signatureRequest.approvalId,
        idempotencyKey: req.body.signatureRequest.idempotencyKey,
        taskId: task.id,
        chain: task.chainSlug,
        contractAddress: task.contractAddress,
        valueWei: req.body.signatureRequest.valueWei || '0',
      }, policy);
    }

    // Mark running immediately
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    appendTaskEvent(task, 'run_requested', config.enableLiveMint ? 'Validated live request sent to signer boundary.' : 'Preflight run requested.');
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
      const cached = false;
      if (!cached) await prewarm.prewarmTask(task, wallets, log);

      const result = await mint.runMintTask(task, wallets, log);
      if (reservation) {
        if (result.txHashes.length) await policyStore.settle(reservation.approvalId);
        else await policyStore.release(reservation.approvalId, 'no_transaction_broadcast');
      }
      // "broadcast" = tx in mempool (got hash); "failed" = no hash at all
      task.status = result.txHashes.length > 0 ? 'broadcast' : 'failed';
      task.minted = result.minted;
      task.txHashes = result.txHashes;
      task.avgBroadcastMs = result.avgBroadcastMs;
      task.avgAttemptMs = result.avgAttemptMs;
      task.walletResults = result.walletResults || [];
      task.error = result.errors.length ? result.errors[0] : null;
      task.finishedAt = new Date().toISOString();
      await taskStore.updateTaskStatus(task.id, task.status, {
        minted: task.minted, txHashes: task.txHashes,
        avgBroadcastMs: task.avgBroadcastMs, avgAttemptMs: task.avgAttemptMs,
        walletResults: task.walletResults,
        error: task.error, finishedAt: task.finishedAt,
      });
      const note = result.txHashes.length
        ? `${result.txHashes.length} tx(s) broadcast in ${result.avgBroadcastMs}ms`
        : (task.error || 'no txs');
      notify.send(`RV3 mint ${task.status}`, `${task.drop} · ${note}`).catch(() => {});
      // Async receipt watch — updates status to confirmed/reverted without blocking response
      if (result.txHashes.length) {
        const watchUrls = rpc.allRpcUrls(task.rpcUrls || [], task.chainSlug || 'ethereum');
        result.txHashes.forEach(hash => {
          receipt.watchAndConfirm(task.id, hash, watchUrls, r => {
            task.status = r.status;
            task.blockNumber = r.blockNumber;
            task.gasUsed = r.gasUsed;
            notify.send(`RV3 mint ${r.status}`, `${task.drop} · block ${r.blockNumber}`).catch(() => {});
          });
        });
      }
    } catch (e) {
      if (reservation) await policyStore.release(reservation.approvalId, 'execution_error').catch(() => {});
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

router.post('/tasks/:id/retry', taskLimiter, async (req, res) => {
  try {
    const src = await resolveTask(req.params.id, req.body?.task);
    if (!src) return res.status(404).json({ error: 'Task not found' });
    if (!['failed', 'reverted'].includes(src.status)) {
      return res.status(400).json({ error: `Cannot retry a ${src.status} task` });
    }
    const failedIds = (src.walletResults || []).filter(r => !r.ok && r.walletId).map(r => r.walletId);
    const clone = {};
    for (const [k, v] of Object.entries(src)) {
      if (k.startsWith('pw_')) continue;
      clone[k] = v;
    }
    clone.id = `task_${Date.now()}`;
    clone.status = 'queued';
    clone.priority = true;
    clone.error = null;
    clone.note = null;
    clone.txHashes = [];
    clone.walletResults = [];
    clone.minted = 0;
    clone.finishedAt = null;
    clone.startedAt = null;
    clone.blockNumber = null;
    clone.gasUsed = null;
    clone.avgBroadcastMs = null;
    clone.avgAttemptMs = null;
    clone.retriedFrom = src.id;
    clone.time = new Date().toLocaleString();
    clone.createdAt = new Date().toISOString();
    if (failedIds.length) {
      clone.retryWalletIds = failedIds;
      clone.wallets = failedIds.length;
    } else {
      delete clone.retryWalletIds;
    }
    const s = state();
    s.tasks.unshift(clone);
    store.appendLog(s, 'info', `Retry queued: ${clone.name || clone.drop} (from ${src.id})`);
    worker.save();
    taskStore.saveTask(clone).catch(() => {});
    res.json({ task: clone });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/skip', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, req.body?.task);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!['queued', 'failed', 'reverted'].includes(task.status)) {
      return res.status(400).json({ error: `Cannot skip a ${task.status} task` });
    }
    task.status = 'skipped';
    task.finishedAt = new Date().toISOString();
    await taskStore.saveTask(task);
    worker.save();
    store.appendLog(state(), 'info', `Task skipped: ${task.name || task.drop}`);
    res.json({ ok: true, status: 'skipped' });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

router.get('/tasks/:id/receipt', async (req, res) => {
  try {
    const task = await resolveTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.txHashes?.length) return res.json({ receipt: null, status: task.status });
    const urls = rpc.allRpcUrls(task.rpcUrls || [], task.chainSlug || 'ethereum');
    const r = await receipt.checkReceipt(task.txHashes[0], urls);
    if (r && task.status === 'broadcast') {
      await taskStore.updateTaskStatus(task.id, r.status, {
        blockNumber: r.blockNumber, gasUsed: r.gasUsed, confirmedAt: new Date().toISOString(),
      });
    }
    res.json({ receipt: r, status: r ? r.status : 'pending' });
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
    chain: String(body.chain || 'ethereum').slice(0, 20),
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

// ── Copy Mint ────────────────────────────────────────────────────────────────

router.get('/copymint', (req, res) => {
  res.json({
    targets: copymint.listTargets(),
    feed: copymint.getFeed(),
    status: copymint.getStatus(),
  });
});

router.get('/copymint/feed', (req, res) => {
  res.json({ feed: copymint.getFeed(), status: copymint.getStatus() });
});

router.post('/copymint', taskLimiter, async (req, res) => {
  try {
    const target = await copymint.addTarget(req.body || {});
    store.appendLog(state(), 'info', `Copy-mint watching ${target.label} (${target.address})`);
    res.json({ target });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/copymint/:id/toggle', async (req, res) => {
  try {
    const target = await copymint.toggleTarget(req.params.id, req.body?.active);
    res.json({ target });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/copymint/scan', async (req, res) => {
  try {
    await copymint.scanOnce();
    res.json({ ok: true, status: copymint.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/copymint/observe', taskLimiter, async (req, res) => {
  try {
    const result = await copymint.observePublicMint(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/copymint/:id', async (req, res) => {
  try {
    await copymint.removeTarget(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delegation batch (on-chain RV3BatchMinter) ───────────────────────────────

function findWallet(id) {
  return state().wallets.find(w => w.id === id || w.address === id);
}

router.get('/delegation', async (req, res) => {
  const deps = state().deployments || [];
  // Best-effort live balances; never let one dead RPC fail the whole list.
  const withBal = await Promise.all(deps.map(async d => {
    let balance = null;
    try { balance = await delegation.contractBalance(d, req.query.rpcUrls || []); } catch { /* */ }
    return { ...d, balance };
  }));
  res.json({ deployments: withBal });
});

router.post('/delegation/deploy', taskLimiter, async (req, res) => {
  const s = state();
  const body = req.body || {};
  const owner = findWallet(String(body.ownerWalletId || ''));
  if (!owner) return res.status(400).json({ error: 'ownerWalletId not found' });
  if (!config.enableLiveMint) return res.status(400).json({ error: 'Set ENABLE_LIVE_MINT=true to deploy contracts' });
  const log = (level, msg) => store.appendLog(s, level, `[deleg] ${msg}`);
  try {
    const dep = await delegation.deploy({
      ownerWallet: owner,
      chain: body.chain || 'ethereum',
      rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
      gasGwei: tx.GAS_PRESETS[body.gasPreset] || tx.GAS_PRESETS.normal,
      log,
    });
    dep.label = String(body.label || 'Batch executor').slice(0, 40);
    s.deployments = [dep, ...(s.deployments || [])];
    worker.save();
    res.json({ deployment: dep });
  } catch (e) {
    log('err', `deploy failed: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

router.post('/delegation/:id/mint', taskLimiter, async (req, res) => {
  const s = state();
  const body = req.body || {};
  const dep = (s.deployments || []).find(d => d.id === req.params.id || d.address === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const owner = findWallet(body.ownerWalletId) || findWallet(dep.ownerId);
  if (!owner) return res.status(400).json({ error: 'Operator wallet not found' });
  if (!config.enableLiveMint) return res.status(400).json({ error: 'Set ENABLE_LIVE_MINT=true to batch mint' });
  const log = (level, msg) => store.appendLog(s, level, `[deleg:${dep.address.slice(0, 8)}] ${msg}`);
  try {
    const result = await delegation.batchMint({
      deployment: dep,
      ownerWallet: owner,
      openseaSlug: String(body.openseaSlug || body.slug || ''),
      qty: Math.max(1, parseInt(body.qty, 10) || 1),
      count: Math.max(1, parseInt(body.count, 10) || 1),
      gasGwei: tx.GAS_PRESETS[body.gasPreset] || tx.GAS_PRESETS.normal,
      rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
      log,
    });
    s.history = [{
      id: `run_${Date.now()}`, type: 'delegation', drop: body.openseaSlug || 'batch mint',
      route: 'DELEGATION', wallets: result.requested, time: new Date().toLocaleString(),
      status: 'completed', minted: result.tokensMinted, txHash: result.txHash,
      note: `${result.succeeded}/${result.requested} mints · block ${result.block}`,
    }, ...(s.history || [])].slice(0, 500);
    worker.save();
    res.json({ result });
  } catch (e) {
    log('err', `batchMint failed: ${e.message}`);
    s.history = [{
      id: `run_${Date.now()}`, type: 'delegation', drop: body.openseaSlug || 'batch mint',
      route: 'DELEGATION', wallets: parseInt(body.count, 10) || 0, time: new Date().toLocaleString(),
      status: 'failed', minted: 0, txHash: null, note: e.message.slice(0, 140),
    }, ...(s.history || [])].slice(0, 500);
    worker.save();
    res.status(502).json({ error: e.message });
  }
});

router.post('/delegation/:id/sweep', taskLimiter, async (req, res) => {
  const s = state();
  const body = req.body || {};
  const dep = (s.deployments || []).find(d => d.id === req.params.id || d.address === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const owner = findWallet(body.ownerWalletId) || findWallet(dep.ownerId);
  if (!owner) return res.status(400).json({ error: 'Operator wallet not found' });
  const log = (level, msg) => store.appendLog(s, level, `[deleg:${dep.address.slice(0, 8)}] ${msg}`);
  try {
    const result = await delegation.sweep({
      deployment: dep, ownerWallet: owner, to: body.to || null,
      gasGwei: tx.GAS_PRESETS[body.gasPreset] || tx.GAS_PRESETS.normal,
      rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
      log,
    });
    worker.save();
    res.json({ result });
  } catch (e) {
    log('err', `sweep failed: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

router.post('/delegation/:id/withdraw', taskLimiter, async (req, res) => {
  const s = state();
  const body = req.body || {};
  const dep = (s.deployments || []).find(d => d.id === req.params.id || d.address === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const owner = findWallet(body.ownerWalletId) || findWallet(dep.ownerId);
  if (!owner) return res.status(400).json({ error: 'Operator wallet not found' });
  const log = (level, msg) => store.appendLog(s, level, `[deleg:${dep.address.slice(0, 8)}] ${msg}`);
  try {
    const result = await delegation.withdraw({
      deployment: dep, ownerWallet: owner, to: body.to || null,
      gasGwei: tx.GAS_PRESETS[body.gasPreset] || tx.GAS_PRESETS.normal,
      rpcUrls: (body.rpcUrls || []).filter(u => typeof u === 'string' && u.startsWith('https://')),
      log,
    });
    worker.save();
    res.json({ result });
  } catch (e) {
    log('err', `withdraw failed: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

router.delete('/delegation/:id', (req, res) => {
  const s = state();
  const before = (s.deployments || []).length;
  s.deployments = (s.deployments || []).filter(d => d.id !== req.params.id && d.address !== req.params.id);
  worker.save();
  res.json({ ok: true, removed: before - s.deployments.length });
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
