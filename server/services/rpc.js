'use strict';

const { ethers } = require('ethers');
const config = require('../config');

async function ping(url, timeout = 5000) {
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return Date.now() - start;
}

async function getBlockNumber(url) {
  const provider = new ethers.JsonRpcProvider(url);
  return Number(await provider.getBlockNumber());
}

async function getBalance(url, address) {
  const provider = new ethers.JsonRpcProvider(url);
  const wei = await provider.getBalance(address);
  return parseFloat(ethers.formatEther(wei));
}

async function getGasPrice(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  const gwei = Number(BigInt(data.result)) / 1e9;
  return Math.round(gwei * 10) / 10;
}

function decodeRevertReason(hexData) {
  if (!hexData || hexData === '0x') return null;
  try {
    if (hexData.startsWith('0x08c379a0')) {
      const hex = hexData.slice(10);
      const len = parseInt(hex.slice(64, 128), 16);
      return Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0/g, '');
    }
  } catch { /* */ }
  return null;
}

async function simulateCall(url, from, to, data, value = '0x0') {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ from, to, data: data || '0x', value }, 'latest'],
      id: 1,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) {
    const reason = decodeRevertReason(j.error.data) || j.error.message || 'execution reverted';
    throw new Error(reason);
  }
  return j.result;
}

/**
 * Batch JSON-RPC — fires multiple calls in a single HTTP request.
 * Returns results array in the same order as calls.
 * Falls back gracefully: if batch fails, runs calls individually.
 */
async function batchCall(url, calls, timeout = 5000) {
  const body = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [],
  }));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // JSON-RPC batch responses may come back out of order — sort by id
    if (!Array.isArray(data)) throw new Error('non-array batch response');
    const ordered = new Array(calls.length);
    for (const r of data) { if (r.id >= 1 && r.id <= calls.length) ordered[r.id - 1] = r.result ?? null; }
    return ordered;
  } catch {
    // Fallback: individual calls
    return Promise.all(calls.map(async c => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: c.method, params: c.params || [] }),
        signal: AbortSignal.timeout(timeout),
      }).then(r => r.json());
      return r.result ?? null;
    }));
  }
}

/**
 * Fetch nonce + chainId in a single batch RPC call.
 * Returns { nonce, chainId } — all numbers/bigints.
 */
async function getWalletNonceAndChain(url, address) {
  const [nonceHex, chainHex] = await batchCall(url, [
    { method: 'eth_getTransactionCount', params: [address, 'pending'] },
    { method: 'eth_chainId', params: [] },
  ]);
  return {
    nonce: parseInt(nonceHex, 16),
    chainId: BigInt(chainHex),
  };
}

function allRpcUrls(extra = []) {
  const urls = new Set();
  for (const r of config.envRpcs) urls.add(r.url);
  for (const r of extra) {
    const url = typeof r === 'string' ? r : r?.url;
    if (url?.startsWith('https://')) urls.add(url);
  }
  return [...urls];
}

function maskUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.length > 2) parts[parts.length - 1] = parts[parts.length - 1].slice(0, 6) + '…';
    return `${u.origin}${parts.join('/')}`;
  } catch {
    return url.slice(0, 30) + '…';
  }
}

module.exports = { ping, getBlockNumber, getBalance, getGasPrice, simulateCall, batchCall, getWalletNonceAndChain, allRpcUrls, maskUrl };
