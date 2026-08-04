'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const tx = require('./tx');
const rpc = require('./rpc');
const prewarm = require('./prewarm');
const taskStore = require('./taskStore');
const routes = require('./routes');
const { decrypt } = require('./crypto');

const GAS_LIMIT = 350000n;

async function executeMintForWallet(walletEntry, task, log) {
  const slug = task.openseaSlug;
  if (!slug) throw new Error('No OpenSea slug — re-detect the drop');

  const normalizedRoute = routes.normalizeRoute(task.route);
  if (normalizedRoute === routes.ROUTES.DELEGATION) {
    throw new Error('Delegation batch route not deployed — use Direct RPC or Flashbots Protect');
  }

  const chainSlug = task.chainSlug || 'ethereum';
  const pk = decrypt(walletEntry.encryptedKey);
  const signer = new ethers.Wallet(pk);
  const minter = await signer.getAddress();

  const blast = task.rpcBlast !== false;
  // Flashbots relay/bundle are Ethereum-only — downgrade to direct RPC on any
  // other chain so the tx is never sent to the Ethereum relay/builders.
  const effRoute = chainSlug === 'ethereum'
    ? routes.normalizeRoute(task.route)
    : routes.ROUTES.DIRECT_RPC;
  const sendUrls = tx.pickSendUrls(effRoute, task.rpcUrls || [], chainSlug);
  if (!sendUrls.length) throw new Error('No RPC available');

  const fastest = await rpc.getFastestUrl(sendUrls);

  const memCached = prewarm.getEntry(task.id, walletEntry.id);
  const neonCached = (!memCached?.mintTx)
    ? await taskStore.getPrewarmCache(task.id, walletEntry.id).catch(() => null)
    : null;

  let mintTx = memCached?.mintTx || neonCached?.mintTx || null;
  let preSigned = memCached?.signed || neonCached?.signed || null;
  const alreadySimulated = !!(mintTx && (memCached?.simulated ?? true));
  const gasGwei = task.gasGwei || tx.GAS_PRESETS.normal;
  const start = Date.now();

  // ── Tier 1 (~50ms): pre-signed tx cached → immediate blast ──
  if (preSigned) {
    log('info', `${walletEntry.name} — T1 pre-signed blast`);
    try {
      const hash = await tx.broadcastRaw(preSigned, sendUrls, {
        blast, route: effRoute, targetBlock: task.targetBlock,
      });
      const broadcastMs = Date.now() - start;
      log('ok', `${walletEntry.name} — ${hash.slice(0, 14)}… in ${broadcastMs}ms [T1]`);
      prewarm.clearEntry(task.id, walletEntry.id);
      return { hash, gasUsed: 0n, broadcastMs, tier: 1 };
    } catch (e) {
      if (!/nonce|already known|replacement|underpriced/i.test(e.message)) throw e;
      log('info', `${walletEntry.name} — T1 nonce stale → T2 re-sign`);
      preSigned = null;
    }
  }

  // ── Slow path: fetch calldata if not cached ──
  if (!mintTx) {
    log('info', `${walletEntry.name} — T3 fetching calldata (not pre-warmed)`);
    mintTx = await opensea.buildDropMintTransaction(slug, minter, task.qty || 1);

    const provider = new ethers.JsonRpcProvider(fastest);
    const bal = await provider.getBalance(minter);
    const gasCost = ethers.parseUnits(String(gasGwei), 'gwei') * GAS_LIMIT;
    if (bal < mintTx.value + gasCost) {
      throw new Error(`${walletEntry.name}: need ${ethers.formatEther(mintTx.value + gasCost)} ETH, have ${ethers.formatEther(bal)}`);
    }
    await rpc.simulateCall(fastest, minter, mintTx.to, mintTx.data, '0x' + mintTx.value.toString(16));
    log('info', `${walletEntry.name} — simulation passed`);
  }

  // ── Tier 2 (~150ms): calldata cached, sign fresh nonce → blast ──
  log('info', `${walletEntry.name} — T2 sign + blast`);
  const { signed, maxFee } = await tx.buildAndSign(signer, {
    to: mintTx.to, data: mintTx.data, value: mintTx.value, gasLimit: GAS_LIMIT,
  }, { rpcUrl: fastest, gasGwei });

  const signMs = Date.now() - start;
  const hash = await tx.broadcastRaw(signed, sendUrls, {
    blast, route: effRoute, targetBlock: task.targetBlock,
  });
  const broadcastMs = Date.now() - start;

  log('ok', `${walletEntry.name} — ${hash.slice(0, 14)}… sign ${signMs}ms · total ${broadcastMs}ms · maxFee ${maxFee?.toFixed(2)}gwei [T${mintTx ? 2 : 3}]`);
  prewarm.clearEntry(task.id, walletEntry.id);
  return { hash, gasUsed: 0n, broadcastMs, signMs, tier: mintTx ? 2 : 3 };
}

async function runMintTask(task, wallets, log) {
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) throw new Error('No wallets with server keys imported');

  const chainSlug = task.chainSlug || 'ethereum';
  const sendUrls = tx.pickSendUrls(task.route, task.rpcUrls || [], chainSlug);

  if (task.rpcPrewarm !== false && sendUrls.length) {
    await rpc.prewarmUrls(sendUrls);
  }

  let minted = 0;
  let totalGas = 0n;
  let totalBroadcastMs = 0;
  let totalAttemptMs = 0;
  const txHashes = [];
  const errors = [];

  const results = await Promise.allSettled(selected.map(async w => {
    const t0 = Date.now();
    try {
      return await executeMintForWallet(w, task, log);
    } catch (e) {
      e.attemptMs = Date.now() - t0;
      throw e;
    }
  }));

  for (const res of results) {
    if (res.status === 'fulfilled') {
      minted += task.qty || 1;
      totalGas += res.value.gasUsed || 0n;
      totalBroadcastMs += res.value.broadcastMs || 0;
      totalAttemptMs += res.value.broadcastMs || 0;
      txHashes.push(res.value.hash);
    } else {
      const msg = res.reason?.message || String(res.reason);
      errors.push(msg);
      totalAttemptMs += res.reason?.attemptMs || 0;
      log('err', msg);
    }
  }

  const count = selected.length;
  const avgBroadcastMs = txHashes.length ? Math.round(totalBroadcastMs / txHashes.length) : null;
  const avgAttemptMs = count ? Math.round(totalAttemptMs / count) : null;
  return { minted, txHashes, totalGas, errors, avgBroadcastMs, avgAttemptMs };
}

module.exports = { runMintTask, executeMintForWallet };
