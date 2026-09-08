'use strict';

const config = require('../config');
const gql = require('./gql');

const BASE = 'https://api.opensea.io/api/v2';
const DEFAULT_TIMEOUT = 8000;
const FAST_TIMEOUT = 5000;

const dropCache = new Map(); // slug → { data, at }
const DROP_CACHE_MS = 15_000;

async function osFetch(path, opts = {}) {
  if (!config.openseaApiKey) throw new Error('OPENSEA_API_KEY not configured in .env');
  const { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = opts;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-API-KEY': config.openseaApiKey,
      Accept: 'application/json',
      Connection: 'keep-alive',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    if (res.status === 429) throw new Error(`OpenSea rate limit reached${retryAfter ? `; retry after ${retryAfter} seconds` : ''}`);
    throw new Error(`OpenSea request failed (${res.status})`);
  }
  const data = await res.json();
  return { ...data, _rv3RateLimit: {
    limit: res.headers.get('x-ratelimit-limit'),
    remaining: res.headers.get('x-ratelimit-remaining'),
    reset: res.headers.get('x-ratelimit-reset'),
  } };
}

function chainSlug(chain) {
  const c = (chain || 'ethereum').toLowerCase();
  if (c === 'eth' || c === 'ethereum') return 'ethereum';
  if (c === 'base') return 'base';
  if (c === 'blast') return 'blast';
  if (c === 'polygon' || c === 'matic') return 'polygon';
  if (c === 'robinhood' || c === 'rh' || c === 'robinhood-chain') return 'robinhood';
  return 'ethereum';
}

function displayChain(slug) {
  const map = { ethereum: 'Ethereum', base: 'Base', blast: 'Blast', polygon: 'Polygon', robinhood: 'Robinhood' };
  return map[slug] || 'Ethereum';
}

async function getCollection(slug) {
  return osFetch(`/collections/${encodeURIComponent(slug)}`);
}

async function getContract(chain, address) {
  return osFetch(`/chain/${chainSlug(chain)}/contract/${address.toLowerCase()}`);
}

async function getCollectionStats(slug) {
  try {
    return await osFetch(`/collections/${encodeURIComponent(slug)}/stats`);
  } catch {
    return null;
  }
}

async function getSupportedChains() {
  const data = await osFetch('/chains');
  return data.chains || data || [];
}

async function getDrop(slug) {
  const cached = dropCache.get(slug);
  if (cached && Date.now() - cached.at < DROP_CACHE_MS) return cached.data;

  // REST v2 is the supported OpenSea integration. GraphQL, when explicitly
  // enabled for diagnostics, may only provide a read-only fallback.
  let data;
  try { data = await osFetch(`/drops/${encodeURIComponent(slug)}`); }
  catch (restError) {
    if (!config.openseaGraphqlEnabled) throw restError;
    data = await gql.getDropInfo(slug);
    if (!data) throw restError;
  }

  dropCache.set(slug, { data, at: Date.now() });
  return data;
}

/**
 * Critical path for mint speed — returns SeaDrop calldata { to, data, value }.
 * Races GQL mutation vs REST POST; whichever responds first wins.
 * Both paths are identical in output shape so callers are unaffected.
 */
async function buildDropMintTransaction(slug, minter, quantity = 1, timeout = FAST_TIMEOUT) {
  const data = await osFetch(`/drops/${encodeURIComponent(slug)}/mint`, {
    method: 'POST',
    body: { minter: minter.toLowerCase(), quantity },
    timeout,
  });
  if (!data.to && !data.target) throw new Error('OpenSea returned incomplete mint transaction data');
  return { to: data.to || data.target, data: data.data || data.calldata, value: BigInt(data.value || '0'), _source: 'rest-v2' };
}

/** Prefetch calldata for multiple wallets in parallel — use during prewarm window. */
async function buildDropMintBatch(slug, minters, quantity = 1) {
  return Promise.allSettled(
    minters.map(m => buildDropMintTransaction(slug, m, quantity))
  );
}

async function getAccountNfts(chain, address, limit = 50) {
  const ch = chainSlug(chain);
  const data = await osFetch(`/chain/${ch}/account/${address.toLowerCase()}/nfts?limit=${limit}`);
  return data.nfts || [];
}

async function buildTransferActions(fromAddress, toAddress, assets) {
  return osFetch('/assets/transfer', {
    method: 'POST',
    body: {
      from_address: fromAddress.toLowerCase(),
      to_address: toAddress.toLowerCase(),
      assets: assets.map(a => ({
        token_address: a.contract.toLowerCase(),
        token_id: String(a.tokenId),
        chain: chainSlug(a.chain || 'ethereum'),
      })),
    },
  });
}

function invalidateDropCache(slug) {
  if (slug) dropCache.delete(slug);
  else dropCache.clear();
}

module.exports = {
  getCollection,
  getContract,
  getCollectionStats,
  getSupportedChains,
  getDrop,
  buildDropMintTransaction,
  buildDropMintBatch,
  getAccountNfts,
  buildTransferActions,
  chainSlug,
  displayChain,
  osFetch,
  invalidateDropCache,
};
