'use strict';

const { ethers } = require('ethers');
const opensea = require('./opensea');
const tx = require('./tx');
const rpc = require('./rpc');
const { decrypt } = require('./crypto');

async function executeMintForWallet(walletEntry, task, log) {
  const slug = task.openseaSlug;
  if (!slug) throw new Error('No OpenSea slug on task — re-detect drop and create task again');

  const pk = decrypt(walletEntry.encryptedKey);
  const urls = tx.pickSendUrls(task.route, task.rpcUrls || []);
  if (!urls.length) throw new Error('No RPC available');
  const provider = new ethers.JsonRpcProvider(urls[0]);
  const signer = new ethers.Wallet(pk, provider);
  const minter = await signer.getAddress();

  log('info', `${walletEntry.name} building mint tx via OpenSea · ${slug} · qty ${task.qty || 1}`);
  const mintTx = await opensea.buildDropMintTransaction(slug, minter, task.qty || 1);

  const gasGwei = task.gasGwei || tx.GAS_PRESETS.normal;
  const bal = await provider.getBalance(minter);
  const gasCost = ethers.parseUnits(String(gasGwei), 'gwei') * 350000n;
  const need = mintTx.value + gasCost;
  if (bal < need) {
    throw new Error(`${walletEntry.name} insufficient balance (need ~${ethers.formatEther(need)} ETH)`);
  }

  log('info', `${walletEntry.name} sending mint · value ${ethers.formatEther(mintTx.value)} ETH`);
  const { hash, receipt } = await tx.sendTx(signer, {
    to: mintTx.to,
    data: mintTx.data,
    value: mintTx.value,
    gasLimit: 350000n,
  }, {
    route: task.route,
    rpcUrls: task.rpcUrls,
    gasGwei,
    blast: task.rpcBlast !== false,
    wait: true,
  });

  log('ok', `${walletEntry.name} minted · tx ${hash.slice(0, 14)}… · block ${receipt.blockNumber}`);
  return { hash, gasUsed: receipt.gasUsed };
}

async function runMintTask(task, wallets, log) {
  const selected = wallets.filter(w => w.encryptedKey).slice(0, task.wallets || 1);
  if (!selected.length) throw new Error('No server wallets with keys imported');

  let minted = 0;
  let totalGas = 0n;
  const txHashes = [];
  const errors = [];

  for (const w of selected) {
    try {
      const r = await executeMintForWallet(w, task, log);
      minted += task.qty || 1;
      totalGas += r.gasUsed || 0n;
      txHashes.push(r.hash);
    } catch (e) {
      errors.push(`${w.name}: ${e.message}`);
      log('err', `${w.name}: ${e.message}`);
    }
  }

  return { minted, txHashes, totalGas, errors };
}

module.exports = { runMintTask, executeMintForWallet };
