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
  return provider.getBlockNumber();
}

async function getBalance(url, address) {
  const provider = new ethers.JsonRpcProvider(url);
  const wei = await provider.getBalance(address);
  return parseFloat(ethers.formatEther(wei));
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
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.length > 2) parts[parts.length - 1] = parts[parts.length - 1].slice(0, 6) + '…';
    return `${u.origin}${parts.join('/')}`;
  } catch {
    return url.slice(0, 30) + '…';
  }
}

module.exports = { ping, getBlockNumber, getBalance, allRpcUrls, maskUrl };
