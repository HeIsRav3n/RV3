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
    version: '1.5.0',
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
      ...r,
      url: rpc.maskUrl(r.url),
      urlFull: undefined,
    })),
  });
});

router.post('/rpc/ping', async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (id) {
      const envRpc = config.envRpcs.find(r => r.id === id);
      if (!envRpc) return res.status(404).json({ error: 'Env RPC not found' });
      const ms = await rpc.ping(envRpc.url);
      return res.json({ ms, ok: true });
    }
    const url = String(req.body?.url || '').trim();
    if (!url.startsWith('https://')) return res.status(400).json({ error: 'HTTPS URL required' });
    const ms = await rpc.ping(url);
    res.json({ ms, ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message, ok: false });
  }
});

router.get('/wallets', (req, res) => {
  const s = state();
  res.json({
    wallets: s.wallets.map(w => ({
      id: w.id, name: w.name, addr: w.address || w.addr, address: w.address,
      eth: w.eth || 0, chain: w.chain || 'ETH', low: !!w.low,
      hasKey: !!w.encryptedKey,
    })),
  });
});

router.post('/wallets/refresh', async (req, res) => {
  try {
    await worker.refreshWalletBalances();
    worker.save();
    res.json({ wallets: state().wallets.map(w => ({ id: w.id, eth: w.eth, low: w.low })) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/wallets/import', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    let key = String(req.body?.privateKey || '').trim();
    const bal = parseFloat(req.body?.balance) || 0;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!key) return res.status(400).json({ error: 'privateKey required' });
    if (!key.startsWith('0x')) key = `0x${key}`;
    const address = addressFromKey(key);
    if (!address) return res.status(400).json({ error: 'Invalid private key' });

    const s = state();
    const entry = {
      id: `w_${Date.now()}`,
      name,
      address,
      addr: `${address.slice(0, 8)}...${address.slice(-6)}`,
      eth: bal,
      chain: 'ETH',
      low: bal < 0.01,
      nonce: 0,
      createdAt: new Date().toISOString(),
    };

    if (!config.hasWalletEncryption) {
      return res.status(400).json({
        error: 'Set WALLET_ENCRYPTION_KEY in .env (64-char hex) before importing keys server-side',
      });
    }
    entry.encryptedKey = encrypt(key);

    s.wallets.push(entry);
    worker.save();
    res.json({ wallet: { id: entry.id, name: entry.name, addr: entry.addr, address: entry.address, eth: entry.eth } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/wallets/:id', (req, res) => {
  const s = state();
  s.wallets = s.wallets.filter(w => w.id !== req.params.id);
  worker.save();
  res.json({ ok: true });
});

router.get('/tasks', (req, res) => {
  res.json({ tasks: state().tasks });
});

router.post('/tasks', taskLimiter, (req, res) => {
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
  store.appendLog(s, 'info', `Task queued: ${task.name}${task.openseaSlug ? ` · ${task.openseaSlug}` : ''}`);
  worker.save();
  res.json({ task });
});

router.delete('/tasks/:id', (req, res) => {
  const s = state();
  s.tasks = s.tasks.filter(t => t.id !== req.params.id);
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
