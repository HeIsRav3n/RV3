'use strict';

const { ethers } = require('ethers');
const config = require('../config');
const rpc = require('./rpc');

const GAS_PRESETS = { slow: 3, normal: 7, fast: 15, turbo: 25 };

function gweiFromPreset(preset, custom) {
  if (preset === 'custom' && custom) return Math.min(Math.max(parseFloat(custom) || 7, 1), 999);
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

/**
 * Broadcast a signed raw transaction to all endpoints simultaneously.
 * Returns the first hash that comes back — doesn't wait for all.
 */
async function broadcastRaw(signedTx, urls) {
  const payload = JSON.stringify({
    jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: [signedTx], id: 1,
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
  if (!ok) throw new Error(results.map(r => r.reason?.message || 'broadcast failed').join(' | '));
  return ok.value;
}

/**
 * Build and sign a transaction without broadcasting.
 * Uses batch RPC to fetch nonce + chainId in a single round-trip.
 */
async function buildAndSign(signer, txRequest, opts = {}) {
  const { rpcUrl, gasGwei = 20 } = opts;
  const gasLimit = BigInt(txRequest.gasLimit ?? 350000);

  // Single batch call: nonce + chainId (saves one full RPC round-trip vs two separate calls)
  const { nonce, chainId } = await rpc.getWalletNonceAndChain(rpcUrl, await signer.getAddress());

  const tx = {
    to: txRequest.to,
    data: txRequest.data || '0x',
    value: txRequest.value ?? 0n,
    nonce,
    chainId,
    gasLimit,
    type: 2,
    maxFeePerGas: ethers.parseUnits(String(gasGwei), 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(String(Math.min(gasGwei, 2)), 'gwei'),
  };

  const signed = await signer.signTransaction(tx);
  return { signed, nonce, chainId };
}

/**
 * Full send: build → sign → broadcast → wait for receipt.
 * simulate: if true runs eth_call before signing (skip when pre-warmed).
 */
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

  const minter = await signer.getAddress();

  if (simulate) {
    const hexValue = '0x' + (txRequest.value ?? 0n).toString(16);
    await rpc.simulateCall(urls[0], minter, txRequest.to, txRequest.data, hexValue);
  }

  const start = Date.now();

  if (blast && urls.length > 1 && !String(route).toLowerCase().includes('private')) {
    // batch sign then blast all endpoints in parallel
    const { signed } = await buildAndSign(signer, txRequest, { rpcUrl: urls[0], gasGwei });
    const hash = await broadcastRaw(signed, urls);
    if (!wait) return { hash, receipt: null, confirmMs: Date.now() - start };
    const provider = new ethers.JsonRpcProvider(urls[0]);
    const receipt = await provider.waitForTransaction(hash, 1, timeout);
    if (!receipt || receipt.status === 0) throw new Error('Transaction reverted on-chain');
    return { hash, receipt, confirmMs: Date.now() - start };
  }

  // Single-endpoint path
  const provider = new ethers.JsonRpcProvider(urls[0]);
  const connected = signer.connect(provider);
  const { nonce, chainId } = await rpc.getWalletNonceAndChain(urls[0], minter);
  const gasLimit = BigInt(txRequest.gasLimit ?? 350000);
  const resp = await connected.sendTransaction({
    to: txRequest.to,
    data: txRequest.data || '0x',
    value: txRequest.value ?? 0n,
    nonce, chainId, gasLimit, type: 2,
    maxFeePerGas: ethers.parseUnits(String(gasGwei), 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(String(Math.min(gasGwei, 2)), 'gwei'),
  });
  if (!wait) return { hash: resp.hash, receipt: null, confirmMs: Date.now() - start };
  const receipt = await resp.wait(1, timeout);
  if (!receipt || receipt.status === 0) throw new Error('Transaction reverted on-chain');
  return { hash: resp.hash, receipt, confirmMs: Date.now() - start };
}

async function estimateGasCostEth(gasGwei, gasLimit = 200000) {
  const fee = ethers.parseUnits(String(gasGwei), 'gwei') * BigInt(gasLimit);
  return parseFloat(ethers.formatEther(fee));
}

module.exports = { sendTx, buildAndSign, broadcastRaw, gweiFromPreset, pickSendUrls, estimateGasCostEth, GAS_PRESETS };
