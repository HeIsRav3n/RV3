'use strict';

const { ethers } = require('ethers');
const config = require('../config');

const pingCache = new Map(); // url → { ms, at }
const PING_CACHE_MS = 30_000;

async function ping(url, timeout = 4000) {
  const cached = pingCache.get(url);
  if (cached && Date.now() - cached.at < PING_CACHE_MS) return cached.ms;

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  const ms = Date.now() - start;
  pingCache.set(url, { ms, at: Date.now() });
  return ms;
}

/** Warm TCP/TLS connections to all URLs — run before mint fire time. */
async function prewarmUrls(urls) {
  await Promise.allSettled(urls.map(u => ping(u, 3000)));
}

async function getFastestUrl(urls) {
  const list = [...new Set(urls.filter(u => u?.startsWith('https://')))];
  if (!list.length) throw new Error('No RPC URLs');
  if (list.length === 1) return list[0];

  const ranked = await Promise.allSettled(list.map(async url => ({ url, ms: await ping(url, 3000) })));
  const ok = ranked
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => a.ms - b.ms);
  return ok[0]?.url || list[0];
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
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
    signal: AbortSignal.timeout(4000),
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
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ from, to, data: data || '0x', value }, 'latest'],
      id: 1,
    }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) {
    const reason = decodeRevertReason(j.error.data) || j.error.message || 'execution reverted';
    throw new Error(reason);
  }
  return j.result;
}

async function batchCall(url, calls, timeout = 4000) {
  const body = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [],
  }));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('non-array batch response');
    const ordered = new Array(calls.length);
    for (const r of data) { if (r.id >= 1 && r.id <= calls.length) ordered[r.id - 1] = r.result ?? null; }
    return ordered;
  } catch {
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

async function getWalletNonceAndChain(url, address) {
  const [nonceHex, chainHex, block] = await batchCall(url, [
    { method: 'eth_getTransactionCount', params: [address, 'pending'] },
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
  ]);
  const baseFeeGwei = block?.baseFeePerGas
    ? Number(BigInt(block.baseFeePerGas)) / 1e9
    : null;
  return {
    nonce: parseInt(nonceHex, 16),
    chainId: BigInt(chainHex),
    baseFeeGwei,
  };
}

function normalizeChain(chain) {
  const c = String(chain || 'ethereum').toLowerCase();
  if (c === 'eth' || c === 'ethereum') return 'ethereum';
  if (c === 'base') return 'base';
  if (c === 'blast') return 'blast';
  if (c === 'polygon' || c === 'matic') return 'polygon';
  if (c === 'robinhood' || c === 'rh' || c === 'robinhood-chain' || c === '4663') return 'robinhood';
  return 'ethereum';
}

// Public fallback RPC per chain — used when no env RPC is configured for that
// chain (best-effort; rate-limited public endpoints, fine for reads/copy-mint).
const PUBLIC_RPC = {
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
};

function publicRpc(chainSlug) {
  return PUBLIC_RPC[normalizeChain(chainSlug)] || null;
}

function getPrivateRpc(chainSlug = 'ethereum') {
  const chain = normalizeChain(chainSlug);
  return config.envRpcs.find(r => r.role === 'Private' && r.chain === chain)
    || config.envRpcs.find(r => r.role === 'Private');
}

function allRpcUrls(extra = [], chainSlug = 'ethereum') {
  const chain = normalizeChain(chainSlug);
  const urls = new Set();
  for (const r of config.envRpcs) {
    if (r.chain === chain) urls.add(r.url);
  }
  if (!urls.size) {
    // Prefer a chain-specific public fallback (e.g. Robinhood) over borrowing
    // another chain's endpoints, which would broadcast to the wrong network.
    const pub = publicRpc(chain);
    if (pub) urls.add(pub);
    else for (const r of config.envRpcs) urls.add(r.url);
  }
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

module.exports = {
  ping, prewarmUrls, getFastestUrl, getBlockNumber, getBalance, getGasPrice,
  simulateCall, batchCall, getWalletNonceAndChain, allRpcUrls, getPrivateRpc,
  normalizeChain, maskUrl, publicRpc,
};
