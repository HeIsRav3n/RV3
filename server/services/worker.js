'use strict';

const { ethers } = require('ethers');
const config = require('../config');
const store = require('../store');
const rpc = require('./rpc');
const notify = require('./notify');
const mint = require('./mint');
const fund = require('./fund');
const sweep = require('./sweep');
const tx = require('./tx');
const prices = require('./prices');
const walletStore = require('./wallets');
const prewarm = require('./prewarm');

let running = false;
let state = store.load();

function getState() { return state; }
function setState(s) { state = s; }
function save() { store.save(state); }

async function refreshWalletBalances() {
  const urls = rpc.allRpcUrls();
  if (!urls.length) return;
  const url = urls[0];
  await Promise.allSettled(state.wallets.map(async w => {
    if (!w.address) return;
    try {
      w.eth = await rpc.getBalance(url, w.address);
      w.low = w.eth < 0.01;
      await walletStore.updateBalance(w.id, w.eth);
    } catch { /* keep last */ }
  }));
}

function parseScheduleTime(task) {
  if (task.scheduledAt) return new Date(task.scheduledAt).getTime();
  if (!task.scheduledFor) return 0;
  const t = new Date(task.scheduledFor).getTime();
  return isNaN(t) ? 0 : t;
}

function isTaskReady(task) {
  const at = parseScheduleTime(task);
  if (!at) return true;
  return Date.now() >= at - 1;
}

// Pre-warm tasks that are within 10s of their scheduled fire time (or immediately if unscheduled)
async function prewarmPending() {
  const now = Date.now();
  const candidates = state.tasks.filter(t => {
    if (t.status !== 'queued') return false;
    if (!t.openseaSlug) return false;
    const at = parseScheduleTime(t);
    return !at || (at - now) <= 10_000;
  });
  for (const task of candidates) {
    const hasPrewarm = state.wallets
      .filter(w => w.encryptedKey)
      .slice(0, task.wallets || 1)
      .every(w => prewarm.isReady(task.id, w.id));
    if (!hasPrewarm) {
      const log = (level, msg) => store.appendLog(state, level, msg);
      prewarm.prewarmTask(task, state.wallets, log).catch(() => {});
    }
  }
}

function pickNextQueued(priorityId) {
  const mintTasks = state.tasks.filter(t => t.status === 'queued' && isTaskReady(t));
  let mintTask = priorityId ? mintTasks.find(t => t.id === priorityId) : null;
  if (!mintTask) mintTask = mintTasks.find(t => t.priority) || mintTasks[0];
  if (mintTask) return { type: 'mint', item: mintTask };
  const fundOp = state.fundOps.find(o => o.status === 'queued');
  if (fundOp) return { type: 'fund', item: fundOp };
  const sweepOp = state.sweepOps.find(o => o.status === 'queued');
  if (sweepOp) return { type: 'sweep', item: sweepOp };
  return null;
}

async function finishRun(entry) {
  state.history = [entry, ...state.history].slice(0, 500);
  save();
}

async function processMintTask(task) {
  const log = (level, message) => store.appendLog(state, level, `[mint:${task.id}] ${message}`);

  task.status = 'running';
  task.startedAt = new Date().toISOString();
  save();
  log('info', `Start · ${task.drop} · ${task.wallets} wallet(s)`);

  const urls = rpc.allRpcUrls(task.rpcUrls || []);
  if (!urls.length) {
    task.status = 'failed';
    task.error = 'No RPC — set ETH_RPC_PRIMARY in .env';
    save();
    return;
  }

  const pings = await Promise.allSettled(urls.map(u => rpc.ping(u)));
  const okRpc = pings.filter(p => p.status === 'fulfilled').length;
  log('info', `RPC preflight ${okRpc}/${urls.length} OK`);

  if (!config.enableLiveMint) {
    task.status = 'completed';
    task.result = 'preflight_only';
    task.note = 'Preflight passed. Set ENABLE_LIVE_MINT=true in .env to execute mints.';
    task.finishedAt = new Date().toISOString();
    save();
    await finishRun({
      id: `run_${Date.now()}`, type: 'mint', drop: task.drop, route: task.route,
      wallets: task.wallets, qty: task.qty, time: new Date().toLocaleString(),
      status: 'completed', minted: 0, gasCostUsd: 0, note: task.note, openseaSlug: task.openseaSlug,
    });
    await notify.send('RV3 preflight OK', `${task.drop} · ${okRpc} RPCs`);
    return;
  }

  if (!task.openseaSlug) {
    task.status = 'failed';
    task.error = 'Missing openseaSlug — detect drop via OpenSea URL and re-create task';
    task.finishedAt = new Date().toISOString();
    save();
    return;
  }

  try {
    const result = await mint.runMintTask(task, state.wallets, log);
    const ethUsd = await prices.getEthUsd();
    const gasEth = parseFloat(ethers.formatEther(result.totalGas || 0n));
    const gasCostUsd = gasEth * ethUsd;

    task.status = result.txHashes.length > 0 ? 'broadcast' : 'failed';
    task.minted = result.minted;
    task.txHashes = result.txHashes;
    task.avgBroadcastMs = result.avgBroadcastMs;
    task.error = result.errors.length ? result.errors.join('; ') : null;
    task.note = result.txHashes.length > 0
      ? `${result.txHashes.length} tx(s) broadcast in ${result.avgBroadcastMs}ms`
      : task.error;
    task.finishedAt = new Date().toISOString();
    save();

    await finishRun({
      id: `run_${Date.now()}`, type: 'mint', drop: task.drop, route: task.route,
      wallets: task.wallets, qty: task.qty, time: new Date().toLocaleString(),
      status: task.status,
      minted: result.minted, gasEth, gasCostUsd,
      avgBroadcastMs: result.avgBroadcastMs,
      txHash: result.txHashes[0] || null, note: task.note, openseaSlug: task.openseaSlug,
    });
    await notify.send(`RV3 mint ${task.status}`, `${task.drop} · ${task.note}`);
  } catch (e) {
    task.status = 'failed';
    task.error = e.message;
    task.finishedAt = new Date().toISOString();
    save();
    log('err', e.message);
    await notify.send('RV3 mint failed', `${task.drop} · ${e.message}`);
  }
}

async function processFundOp(op) {
  const log = (level, message) => store.appendLog(state, level, `[fund:${op.id}] ${message}`);
  op.status = 'running';
  save();
  try {
    if (!config.enableLiveMint) {
      op.status = 'completed';
      op.note = 'Simulated — set ENABLE_LIVE_MINT=true to send ETH';
      save();
      return;
    }
    const { txHashes, count } = await fund.runFundOp(op, state.wallets, log);
    op.status = 'completed';
    op.txHashes = txHashes;
    op.note = `${count} transfer(s) sent`;
    await finishRun({
      id: `run_${Date.now()}`, type: 'fund', drop: op.op, route: 'FUND', wallets: count,
      time: new Date().toLocaleString(), status: 'completed', minted: 0, gasCostUsd: 0,
      txHash: txHashes[0] || null, note: op.note,
    });
    await notify.send('RV3 fund complete', `${op.op} · ${count} tx(s)`);
  } catch (e) {
    op.status = 'failed';
    op.error = e.message;
    log('err', e.message);
    await notify.send('RV3 fund failed', e.message);
  }
  save();
}

async function processSweepOp(op) {
  const log = (level, message) => store.appendLog(state, level, `[sweep:${op.id}] ${message}`);
  op.status = 'running';
  save();
  try {
    if (!config.enableLiveMint) {
      op.status = 'completed';
      op.note = 'Simulated — set ENABLE_LIVE_MINT=true to transfer NFTs';
      save();
      return;
    }
    const { txHashes, transferred } = await sweep.runSweepOp(op, state.wallets, log);
    op.status = transferred > 0 ? 'completed' : 'failed';
    op.txHashes = txHashes;
    op.note = transferred > 0 ? `${transferred} NFT(s) swept` : 'No NFTs transferred';
    await finishRun({
      id: `run_${Date.now()}`, type: 'sweep', drop: 'NFT sweep', route: 'SWEEP',
      wallets: op.sourceIds?.length || 0, time: new Date().toLocaleString(),
      status: op.status === 'completed' ? 'completed' : 'failed',
      minted: transferred, txHash: txHashes[0] || null, note: op.note,
    });
    await notify.send(`RV3 sweep ${op.status}`, op.note);
  } catch (e) {
    op.status = 'failed';
    op.error = e.message;
    log('err', e.message);
  }
  save();
}

async function tick(priorityId) {
  // Always prewarm candidates before attempting to execute
  prewarmPending().catch(() => {});

  if (running) return;
  running = true;
  try {
    const next = pickNextQueued(priorityId);
    if (!next) return;
    if (next.type === 'mint') await processMintTask(next.item);
    else if (next.type === 'fund') await processFundOp(next.item);
    else if (next.type === 'sweep') await processSweepOp(next.item);
  } catch (e) {
    store.appendLog(state, 'err', `Worker: ${e.message}`);
    save();
  } finally {
    running = false;
  }
}

async function runNow(taskId) {
  const task = state.tasks.find(t => t.id === taskId && t.status === 'queued');
  if (!task) throw new Error('Task not found or not queued');
  task.priority = true;
  // Prewarm immediately before executing if not already done
  if (task.openseaSlug) {
    const log = (level, msg) => store.appendLog(state, level, msg);
    await prewarm.prewarmTask(task, state.wallets, log).catch(() => {});
  }
  await tick(taskId);
}

async function start() {
  // Load persisted wallets from Neon/file on startup
  try {
    const persisted = await walletStore.loadWallets();
    if (persisted.length) state.wallets = persisted;
  } catch (e) {
    store.appendLog(state, 'err', `walletStore.loadWallets: ${e.message}`);
  }
  setInterval(tick, 500);
  setInterval(() => { refreshWalletBalances().catch(() => {}); }, 60000);
  store.appendLog(state, 'info', 'RV3 worker started (mint · fund · sweep)');
  save();
}

module.exports = { start, tick, runNow, getState, setState, save, refreshWalletBalances };
