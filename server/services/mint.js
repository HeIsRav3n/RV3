'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const tx = require('./tx');
const rpc = require('./rpc');
const prewarm = require('./prewarm');
const { decrypt } = require('./crypto');

const GAS_LIMIT = 350000n;

async function executeMintForWallet(walletEntry, task, log) {
  const slug = task.openseaSlug;
  if (!slug) throw new Error('No OpenSea slug — re-detect the drop');

  const pk = decrypt(walletEntry.encryptedKey);
  const signer = new ethers.Wallet(pk);
  const minter = await signer.getAddress();

  const urls = tx.pickSendUrls(task.route, task.rpcUrls || []);
  if (!urls.length) throw new Error('No RPC available');

  // ── Fast path: use pre-warmed calldata (simulation already done) ──
  const cached = prewarm.getEntry(task.id, walletEntry.id);
  let mintTx;
  let alreadySimulated = false;

  if (cached?.mintTx && cached.simulated) {
    mintTx = cached.mintTx;
    alreadySimulated = true;
    log('info', `${walletEntry.name} — pre-warmed ✓ skipping calldata fetch + simulation`);
  } else {
    // ── Slow path: fetch calldata now ──
    log('info', `${walletEntry.name} — fetching calldata (not pre-warmed)`);
    mintTx = await opensea.buildDropMintTransaction(slug, minter, task.qty || 1);

    // balance check (skip when pre-warmed — already checked at pre-warm time)
    const provider = new ethers.JsonRpcProvider(urls[0]);
    const bal = await provider.getBalance(minter);
    const gasGwei = task.gasGwei || tx.GAS_PRESETS.normal;
    const gasCost = ethers.parseUnits(String(gasGwei), 'gwei') * GAS_LIMIT;
    const need = mintTx.value + gasCost;
    if (bal < need) {
      throw new Error(
        `${walletEntry.name}: need ${ethers.formatEther(need)} ETH, have ${ethers.formatEther(bal)}`
      );
    }

    log('info', `${walletEntry.name} — simulating…`);
    await rpc.simulateCall(urls[0], minter, mintTx.to, mintTx.data, '0x' + mintTx.value.toString(16));
    alreadySimulated = true;
    log('info', `${walletEntry.name} — simulation passed`);
  }

  // ── Phase 2+5: batch sign (nonce+chainId in one call) then blast broadcast ──
  const gasGwei = task.gasGwei || tx.GAS_PRESETS.normal;
  const start = Date.now();

  const { signed } = await tx.buildAndSign(signer, {
    to: mintTx.to,
    data: mintTx.data,
    value: mintTx.value,
    gasLimit: GAS_LIMIT,
  }, { rpcUrl: urls[0], gasGwei });

  const hash = await tx.broadcastRaw(signed, urls);
  const broadcastMs = Date.now() - start;
  log('ok', `${walletEntry.name} — broadcast ${hash.slice(0, 14)}… in ${broadcastMs}ms`);

  // Clear pre-warm entry so nonce isn't reused
  prewarm.clearTask(task.id);

  // Don't waitForTransaction — block confirmation (~12s) is chain-controlled and
  // causes false "failed" status when the Lambda times out before the block arrives.
  // The tx is already in the mempool; return hash immediately.
  return { hash, gasUsed: 0n, broadcastMs };
}

async function runMintTask(task, wallets, log) {
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) throw new Error('No wallets with server keys imported');

  let minted = 0;
  let totalGas = 0n;
  let totalBroadcastMs = 0;
  const txHashes = [];
  const errors = [];

  // All wallets fire in parallel — fastest possible execution
  const results = await Promise.allSettled(selected.map(w => executeMintForWallet(w, task, log)));

  for (const res of results) {
    if (res.status === 'fulfilled') {
      minted += task.qty || 1;
      totalGas += res.value.gasUsed || 0n;
      totalBroadcastMs += res.value.broadcastMs || 0;
      txHashes.push(res.value.hash);
    } else {
      const msg = res.reason?.message || String(res.reason);
      errors.push(msg);
      log('err', msg);
    }
  }

  const avgBroadcastMs = txHashes.length ? Math.round(totalBroadcastMs / txHashes.length) : null;
  return { minted, txHashes, totalGas, errors, avgBroadcastMs };
}

module.exports = { runMintTask, executeMintForWallet };
