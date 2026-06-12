'use strict';

const config = require('../config');

const BASE = 'https://api.opensea.io/api/v2';

async function osFetch(path, opts = {}) {
  if (!config.openseaApiKey) throw new Error('OPENSEA_API_KEY not configured in .env');
  const { method = 'GET', body, timeout = 12000 } = opts;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-API-KEY': config.openseaApiKey,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSea ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  return res.json();
}

function chainSlug(chain) {
  const c = (chain || 'ethereum').toLowerCase();
  if (c === 'eth' || c === 'ethereum') return 'ethereum';
  if (c === 'base') return 'base';
  if (c === 'blast') return 'blast';
  if (c === 'polygon' || c === 'matic') return 'polygon';
  return 'ethereum';
}

function displayChain(slug) {
  const map = { ethereum: 'Ethereum', base: 'Base', blast: 'Blast', polygon: 'Polygon' };
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

async function getDrop(slug) {
  return osFetch(`/drops/${encodeURIComponent(slug)}`);
}

async function buildDropMintTransaction(slug, minter, quantity = 1, timeout = 12000) {
  const data = await osFetch(`/drops/${encodeURIComponent(slug)}/mint`, {
    method: 'POST',
    body: { minter: minter.toLowerCase(), quantity },
    timeout,
  });
  return {
    to: data.to || data.target,
    data: data.data || data.calldata,
    value: BigInt(data.value || '0'),
  };
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

module.exports = {
  getCollection,
  getContract,
  getCollectionStats,
  getDrop,
  buildDropMintTransaction,
  getAccountNfts,
  buildTransferActions,
  chainSlug,
  displayChain,
  osFetch,
};
