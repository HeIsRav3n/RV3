'use strict';

const { ethers } = require('ethers');
const config = require('../config');
const rpc = require('./rpc');

const GAS_PRESETS = { slow: 12, normal: 20, fast: 35, turbo: 60 };

function gweiFromPreset(preset, custom) {
  if (preset === 'custom' && custom) return Math.min(Math.max(parseFloat(custom) || 20, 1), 999);
  return GAS_PRESETS[preset] || GAS_PRESETS.normal;
}

function pickSendUrls(route, extra = []) {
  const all = rpc.allRpcUrls(extra);
  const privateRpc = config.envRpcs.find(r => r.role === 'Private');
  const r = String(route || '').toLowerCase();
  if (r.includes('fb_protect') || r.includes('flashbots protect') || r.includes('private')) {
    return privateRpc ? [privateRpc.url] : all.slice(0, 1);
  }
  return all.length ? all : [];
}

async function broadcastRaw(signedTx, urls) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: [signedTx], id: 1 });
  const results = await Promise.allSettled(
    urls.map(url =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(15000),
      }).then(r => r.json()).then(j => {
        if (j.error) throw new Error(j.error.message || 'RPC rejected');
        return j.result;
      })
    )
  );
  const ok = results.find(r => r.status === 'fulfilled');
  if (!ok) throw new Error(results.map(r => r.reason?.message || 'broadcast failed').join(' | '));
  return ok.value;
}

async function sendTx(signer, txRequest, opts = {}) {
  const {
    route = 'DIRECT RPC',
    rpcUrls = [],
    gasGwei = 20,
    blast = true,
    wait = true,
    timeout = 120000,
    simulate = true,
  } = opts;

  const urls = pickSendUrls(route, rpcUrls);
  if (!urls.length) throw new Error('No RPC endpoints configured');

  const provider = new ethers.JsonRpcProvider(urls[0]);
  const connected = signer.connect(provider);
  const minter = await connected.getAddress();
  const nonce = txRequest.nonce ?? await connected.getNonce();
  const chainId = txRequest.chainId ?? (await provider.getNetwork()).chainId;

  const tx = {
    to: txRequest.to,
    data: txRequest.data || '0x',
    value: txRequest.value ?? 0n,
    nonce,
    chainId,
    gasLimit: txRequest.gasLimit ?? 300000n,
    type: 2,
    maxFeePerGas: ethers.parseUnits(String(gasGwei), 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(String(Math.min(gasGwei, 2)), 'gwei'),
  };

  // Simulate via eth_call before spending gas
  if (simulate) {
    const hexValue = '0x' + (tx.value ?? 0n).toString(16);
    await rpc.simulateCall(urls[0], minter, tx.to, tx.data, hexValue);
  }

  const start = Date.now();

  if (blast && urls.length > 1 && !String(route).toLowerCase().includes('private')) {
    const signed = await connected.signTransaction(tx);
    const hash = await broadcastRaw(signed, urls);
    if (!wait) return { hash, receipt: null, confirmMs: Date.now() - start };
    const receipt = await provider.waitForTransaction(hash, 1, timeout);
    if (!receipt || receipt.status === 0) throw new Error('Transaction reverted on-chain');
    return { hash, receipt, confirmMs: Date.now() - start };
  }

  const resp = await connected.sendTransaction(tx);
  if (!wait) return { hash: resp.hash, receipt: null, confirmMs: Date.now() - start };
  const receipt = await resp.wait(1, timeout);
  if (!receipt || receipt.status === 0) throw new Error('Transaction reverted on-chain');
  return { hash: resp.hash, receipt, confirmMs: Date.now() - start };
}

async function estimateGasCostEth(gasGwei, gasLimit = 200000) {
  const fee = ethers.parseUnits(String(gasGwei), 'gwei') * BigInt(gasLimit);
  return parseFloat(ethers.formatEther(fee));
}

module.exports = { sendTx, broadcastRaw, gweiFromPreset, pickSendUrls, estimateGasCostEth, GAS_PRESETS };
