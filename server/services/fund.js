'use strict';

const { ethers } = require('ethers');
const rpc = require('./rpc');
const tx = require('./tx');
const { decrypt } = require('./crypto');

function walletSigner(entry, provider) {
  const pk = decrypt(entry.encryptedKey);
  return new ethers.Wallet(pk, provider);
}

async function runFundOp(op, wallets, log) {
  const hub = wallets.find(w => w.id === op.hubId);
  if (!hub?.encryptedKey) throw new Error('Hub wallet missing or has no server key');
  const targets = wallets.filter(w => op.sourceIds.includes(w.id));
  if (!targets.length) throw new Error('No destination/source wallets selected');

  const chain = rpc.normalizeChain(op.chain || 'ethereum');
  const extraRpcs = op.rpcUrls || [];
  const urls = tx.pickSendUrls('DIRECT RPC', extraRpcs, chain);
  if (!urls.length) throw new Error(`No RPC endpoints configured for ${chain}`);
  const readUrl = await rpc.getFastestUrl(urls);
  const provider = new ethers.JsonRpcProvider(readUrl);
  const gasGwei = op.gasGwei || tx.GAS_PRESETS.normal;
  const amountWei = ethers.parseEther(String(op.amountEth || 0));
  const sendOpts = { gasGwei, chainSlug: chain, rpcUrls: extraRpcs, blast: false, wait: true, simulate: false };
  const txHashes = [];

  // Plain transfers cost exactly 21000 gas on Ethereum, but Arbitrum-stack
  // chains (Robinhood) fold L1 posting costs into gas used — estimate there.
  let transferGas = 21000n;
  if (chain !== 'ethereum') {
    log('info', `Fund op on ${chain}`);
    try {
      const est = await rpc.estimateGas(readUrl, {
        from: hub.address, to: targets[0].address, data: '0x', value: 1n,
      });
      transferGas = (est * 13n) / 10n;
      if (transferGas < 21000n) transferGas = 21000n;
    } catch { transferGas = 400000n; }
  }

  if (op.op === 'distribute' || op.op === 'split') {
    const hubSigner = walletSigner(hub, provider);
    let sendAmount = amountWei;
    if (op.op === 'split') {
      const bal = await provider.getBalance(hub.address);
      const reserve = bal / 50n;
      const spendable = bal > reserve ? bal - reserve : 0n;
      sendAmount = spendable / BigInt(targets.length);
      if (sendAmount <= 0n) throw new Error('Hub balance too low to split');
      log('info', `Split ${ethers.formatEther(sendAmount)} ETH × ${targets.length} wallets`);
    }
    for (const t of targets) {
      if (t.id === hub.id) continue;
      const { hash } = await tx.sendTx(hubSigner, {
        to: t.address,
        value: sendAmount,
        gasLimit: transferGas,
      }, sendOpts);
      txHashes.push(hash);
      log('ok', `Sent ${ethers.formatEther(sendAmount)} ETH → ${t.name}`);
    }
  } else if (op.op === 'consolidate') {
    for (const src of targets) {
      if (src.id === hub.id || !src.encryptedKey) continue;
      const signer = walletSigner(src, provider);
      const bal = await provider.getBalance(src.address);
      const gasCost = ethers.parseUnits(String(gasGwei), 'gwei') * transferGas;
      const sendVal = bal > gasCost * 2n ? bal - gasCost : 0n;
      if (sendVal <= 0n) {
        log('warn', `${src.name} skip — insufficient balance`);
        continue;
      }
      const { hash } = await tx.sendTx(signer, {
        to: hub.address,
        value: sendVal,
        gasLimit: transferGas,
      }, sendOpts);
      txHashes.push(hash);
      log('ok', `Consolidated ${ethers.formatEther(sendVal)} ETH from ${src.name} → hub`);
    }
  } else {
    throw new Error(`Unknown fund op: ${op.op}`);
  }

  return { txHashes, count: txHashes.length };
}

module.exports = { runFundOp };
