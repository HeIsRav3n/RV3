'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const tx = require('./tx');
const rpc = require('./rpc');
const { decrypt } = require('./crypto');

async function executeMintForWallet(walletEntry, task, log) {
  const slug = task.openseaSlug;
  if (!slug) throw new Error('No OpenSea slug — re-detect the drop and recreate the task');

  const pk = decrypt(walletEntry.encryptedKey);
  const urls = tx.pickSendUrls(task.route, task.rpcUrls || []);
  if (!urls.length) throw new Error('No RPC available');

  const provider = new ethers.JsonRpcProvider(urls[0]);
  const signer = new ethers.Wallet(pk, provider);
  const minter = await signer.getAddress();

  log('info', `${walletEntry.name} — building tx · ${slug} · qty ${task.qty || 1}`);
  const mintTx = await opensea.buildDropMintTransaction(slug, minter, task.qty || 1);

  const gasGwei = task.gasGwei || tx.GAS_PRESETS.normal;
  const gasLimit = 350000n;
  const bal = await provider.getBalance(minter);
  const gasCost = ethers.parseUnits(String(gasGwei), 'gwei') * gasLimit;
  const need = mintTx.value + gasCost;

  if (bal < need) {
    throw new Error(`${walletEntry.name}: insufficient balance (need ${ethers.formatEther(need)} ETH, have ${ethers.formatEther(bal)} ETH)`);
  }

  log('info', `${walletEntry.name} — simulating tx…`);
  const hexValue = '0x' + mintTx.value.toString(16);
  await rpc.simulateCall(urls[0], minter, mintTx.to, mintTx.data, hexValue);
  log('info', `${walletEntry.name} — simulation passed, broadcasting`);

  const { hash, receipt, confirmMs } = await tx.sendTx(signer, {
    to: mintTx.to,
    data: mintTx.data,
    value: mintTx.value,
    gasLimit,
  }, {
    route: task.route,
    rpcUrls: task.rpcUrls,
    gasGwei,
    blast: task.rpcBlast !== false,
    wait: true,
    simulate: false, // already simulated above
  });

  log('ok', `${walletEntry.name} — minted · ${hash.slice(0, 14)}… · block ${receipt.blockNumber} · ${confirmMs}ms`);
  return { hash, gasUsed: receipt.gasUsed, confirmMs };
}

async function runMintTask(task, wallets, log) {
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) throw new Error('No wallets with server keys imported');

  let minted = 0;
  let totalGas = 0n;
  let totalConfirmMs = 0;
  const txHashes = [];
  const errors = [];

  for (const w of selected) {
    try {
      const r = await executeMintForWallet(w, task, log);
      minted += task.qty || 1;
      totalGas += r.gasUsed || 0n;
      totalConfirmMs += r.confirmMs || 0;
      txHashes.push(r.hash);
    } catch (e) {
      errors.push(`${w.name}: ${e.message}`);
      log('err', `${w.name}: ${e.message}`);
    }
  }

  const avgConfirmMs = txHashes.length ? Math.round(totalConfirmMs / txHashes.length) : null;
  return { minted, txHashes, totalGas, errors, avgConfirmMs };
}

module.exports = { runMintTask, executeMintForWallet };
