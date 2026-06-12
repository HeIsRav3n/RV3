'use strict';

const { ethers } = require('ethers');
const config = require('../config');
const rpc = require('./rpc');

const GAS_PRESETS = { slow: 15, normal: 25, fast: 40, turbo: 80 };

function gweiFromPreset(preset, custom) {
  if (preset === 'custom' && custom) return Math.min(Math.max(parseFloat(custom) || 25, 1), 999);
  return GAS_PRESETS[preset] || GAS_PRESETS.normal;
}

function pickSendUrls(route, extra = []) {
  const all = rpc.allRpcUrls(extra);
  const privateRpc = config.envRpcs.find(r => r.role === 'Private');
  const routeLower = String(route || '').toLowerCase();
  if (routeLower.includes('fb_protect') || routeLower.includes('flashbots protect')) {
    return privateRpc ? [privateRpc.url] : all.slice(0, 1);
  }
  return all.length ? all : [];
}

async function broadcastRaw(signedTx, urls) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [signedTx],
    id: 1,
  });
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
  if (!ok) {
    const msg = results.map(r => r.reason?.message || 'fail').join('; ');
    throw new Error(msg || 'All RPC broadcasts failed');
  }
  return ok.value;
}

async function sendTx(signer, txRequest, opts = {}) {
  const {
    route = 'DIRECT RPC',
    rpcUrls = [],
    gasGwei = 25,
    blast = true,
    wait = true,
    timeout = 120000,
  } = opts;

  const urls = pickSendUrls(route, rpcUrls);
  if (!urls.length) throw new Error('No RPC endpoints configured');

  const provider = new ethers.JsonRpcProvider(urls[0]);
  const connected = signer.connect(provider);
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
    maxPriorityFeePerGas: ethers.parseUnits(String(Math.min(gasGwei, 3)), 'gwei'),
  };

  if (blast && urls.length > 1 && !String(route).toLowerCase().includes('fb_protect')) {
    const signed = await connected.signTransaction(tx);
    const hash = await broadcastRaw(signed, urls);
    if (!wait) return { hash, receipt: null };
    const receipt = await provider.waitForTransaction(hash, 1, timeout);
    if (!receipt || receipt.status === 0) throw new Error('Transaction reverted');
    return { hash, receipt };
  }

  const resp = await connected.sendTransaction(tx);
  if (!wait) return { hash: resp.hash, receipt: null };
  const receipt = await resp.wait(1, timeout);
  if (!receipt || receipt.status === 0) throw new Error('Transaction reverted');
  return { hash: resp.hash, receipt };
}

async function estimateGasCostEth(provider, gasGwei, gasLimit = 200000n) {
  const fee = ethers.parseUnits(String(gasGwei), 'gwei') * BigInt(gasLimit);
  return parseFloat(ethers.formatEther(fee));
}

module.exports = { sendTx, broadcastRaw, gweiFromPreset, pickSendUrls, estimateGasCostEth, GAS_PRESETS };
