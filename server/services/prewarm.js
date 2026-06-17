'use strict';

/**
 * Pre-warming cache — fetches calldata + simulates each wallet tx before mint fires.
 * At execution time, mint.js uses cached calldata + batch-fetched nonce/chainId
 * so the only RPC call remaining is eth_sendRawTransaction.
 *
 * cache: taskId → Map<walletId, PrewarmEntry>
 */

const opensea = require('./opensea');
const rpc = require('./rpc');
const tx = require('./tx');
const { decrypt } = require('./crypto');
const { ethers } = require('ethers');
const taskStore = require('./taskStore');

const cache = new Map();

// Max age before pre-warm is considered stale (calldata + simulation)
const STALE_MS = 90_000; // 90s — OpenSea calldata is valid for ~2min

function getEntry(taskId, walletId) {
  const entry = cache.get(taskId)?.get(walletId);
  if (!entry) return null;
  if (Date.now() - entry.prewarmedAt > STALE_MS) return null; // stale
  return entry;
}

function setEntry(taskId, walletId, data) {
  if (!cache.has(taskId)) cache.set(taskId, new Map());
  cache.get(taskId).set(walletId, { ...data, prewarmedAt: Date.now() });
}

function clearTask(taskId) {
  cache.delete(taskId);
}

function isReady(taskId, walletId) {
  const e = getEntry(taskId, walletId);
  return e && e.mintTx && e.simulated && !e.error;
}

async function prewarmWallet(task, wallet, urls, log) {
  try {
    // Derive address from encrypted key for the minter field
    const pk = decrypt(wallet.encryptedKey);
    const signer = new ethers.Wallet(pk);
    const minter = await signer.getAddress();

    // 1. Fetch calldata from OpenSea (300-600ms — do this first, it's the slowest)
    const mintTx = await opensea.buildDropMintTransaction(
      task.openseaSlug, minter, task.qty || 1
    );

    // 2. Simulate — catch reverts before broadcast
    const hexValue = '0x' + (mintTx.value || 0n).toString(16);
    await rpc.simulateCall(urls[0], minter, mintTx.to, mintTx.data, hexValue);

    setEntry(task.id, wallet.id, { mintTx, minter, simulated: true, error: null });
    // Persist to Neon so any Lambda can use it (Vercel Lambda isolation)
    taskStore.savePrewarmCache(task.id, wallet.id, mintTx).catch(() => {});
    log('info', `prewarm OK: ${wallet.name}`);
    return true;
  } catch (e) {
    setEntry(task.id, wallet.id, { mintTx: null, simulated: false, error: e.message });
    log('err', `prewarm fail: ${wallet.name}: ${e.message}`);
    return false;
  }
}

async function prewarmTask(task, wallets, log = () => {}) {
  if (!task.openseaSlug) return;
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) return;
  const urls = tx.pickSendUrls(task.route, task.rpcUrls || []);
  if (!urls.length) return;

  log('info', `[prewarm] ${task.drop} — fetching calldata for ${selected.length} wallet(s)`);
  await Promise.allSettled(selected.map(w => prewarmWallet(task, w, urls, log)));
}

module.exports = { prewarmTask, prewarmWallet, getEntry, isReady, clearTask };
