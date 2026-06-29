'use strict';

/**
 * Pre-warming cache — fetches calldata + simulates each wallet tx before mint fires.
 * At execution time, mint.js uses cached calldata + batch-fetched nonce/chainId
 * so the only RPC call remaining is eth_sendRawTransaction (race broadcast).
 */

const opensea = require('./opensea');
const rpc = require('./rpc');
const tx = require('./tx');
const routes = require('./routes');
const { decrypt } = require('./crypto');
const { ethers } = require('ethers');
const taskStore = require('./taskStore');

const cache = new Map();
const STALE_MS = 90_000;

function getEntry(taskId, walletId) {
  const entry = cache.get(taskId)?.get(walletId);
  if (!entry) return null;
  if (Date.now() - entry.prewarmedAt > STALE_MS) return null;
  return entry;
}

function setEntry(taskId, walletId, data) {
  if (!cache.has(taskId)) cache.set(taskId, new Map());
  cache.get(taskId).set(walletId, { ...data, prewarmedAt: Date.now() });
}

function clearTask(taskId) {
  cache.delete(taskId);
}

function clearEntry(taskId, walletId) {
  cache.get(taskId)?.delete(walletId);
}

function isReady(taskId, walletId) {
  const e = getEntry(taskId, walletId);
  return e && e.mintTx && e.simulated && !e.error;
}

async function prewarmWallet(task, wallet, urls, log) {
  try {
    const pk = decrypt(wallet.encryptedKey);
    const signer = new ethers.Wallet(pk);
    const minter = await signer.getAddress();
    const fastest = await rpc.getFastestUrl(urls);

    // Fetch calldata + warm all RPC connections in parallel
    const [mintTx] = await Promise.all([
      opensea.buildDropMintTransaction(task.openseaSlug, minter, task.qty || 1),
      rpc.prewarmUrls(urls),
    ]);

    const hexValue = '0x' + (mintTx.value || 0n).toString(16);
    await rpc.simulateCall(fastest, minter, mintTx.to, mintTx.data, hexValue);

    // Pre-sign the tx so execution is just a single broadcastRaw call.
    // Use 2x baseFee headroom so the signed tx stays valid even if baseFee rises.
    const gasGwei = task.gasGwei || tx.GAS_PRESETS.fast;
    let signed = null;
    let nonce = null;
    try {
      const result = await tx.buildAndSign(signer, mintTx, { rpcUrl: fastest, gasGwei, feeHeadroom: 2.0 });
      signed = result.signed;
      nonce = result.nonce;
      log('info', `prewarm OK: ${wallet.name} — pre-signed nonce=${nonce} maxFee=${result.maxFee.toFixed(2)}gwei`);
    } catch (signErr) {
      log('info', `prewarm OK: ${wallet.name} — calldata cached (pre-sign skipped: ${signErr.message})`);
    }

    setEntry(task.id, wallet.id, { mintTx, signed, nonce, minter, simulated: true, error: null });
    taskStore.savePrewarmCache(task.id, wallet.id, mintTx, signed, nonce).catch(() => {});
    return true;
  } catch (e) {
    setEntry(task.id, wallet.id, { mintTx: null, signed: null, simulated: false, error: e.message });
    log('err', `prewarm fail: ${wallet.name}: ${e.message}`);
    return false;
  }
}

async function prewarmTask(task, wallets, log = () => {}) {
  if (!task.openseaSlug) return;
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) return;

  const chainSlug = task.chainSlug || 'ethereum';
  const urls = tx.pickSendUrls(task.route, task.rpcUrls || [], chainSlug);
  if (!urls.length) return;

  if (task.rpcPrewarm !== false) {
    await rpc.prewarmUrls(urls);
  }

  log('info', `[prewarm] ${task.drop} — ${selected.length} wallet(s) · route ${routes.displayRoute(task.route)}`);
  await Promise.allSettled(selected.map(w => prewarmWallet(task, w, urls, log)));
}

module.exports = {
  prewarmTask, prewarmWallet, getEntry, isReady, clearTask, clearEntry,
};
