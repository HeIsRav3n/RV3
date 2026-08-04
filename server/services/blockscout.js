'use strict';

// Blockscout explorer API — used for NFT discovery on chains OpenSea does not
// index (e.g. Robinhood Chain). https://docs.blockscout.com/api-reference
const rpc = require('./rpc');

const EXPLORERS = {
  robinhood: 'https://robinhoodchain.blockscout.com',
};

function explorerBase(chain) {
  return EXPLORERS[rpc.normalizeChain(chain)] || null;
}

function supportsChain(chain) {
  return Boolean(explorerBase(chain));
}

// Returns normalized [{ contract, tokenId, std, name }] owned by `address`.
async function getAccountNfts(chain, address, limit = 100) {
  const base = explorerBase(chain);
  if (!base) throw new Error(`No Blockscout explorer configured for chain "${chain}"`);
  const out = [];
  let url = `${base}/api/v2/addresses/${address}/nft?type=ERC-721%2CERC-1155`;
  for (let page = 0; page < 5 && url && out.length < limit; page++) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Blockscout ${res.status} ${res.statusText || ''}`.trim());
    const data = await res.json();
    for (const it of (data.items || [])) {
      const contract = String(it.token?.address_hash || it.token?.address || '').toLowerCase();
      const tokenId = it.id ?? it.token_id;
      if (!/^0x[a-f0-9]{40}$/.test(contract) || tokenId == null) continue;
      out.push({
        contract,
        tokenId: String(tokenId),
        std: it.token_type || it.token?.type || 'ERC-721',
        name: it.token?.name || '',
      });
    }
    const next = data.next_page_params;
    if (next && typeof next === 'object' && Object.keys(next).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) if (v != null) qs.set(k, String(v));
      qs.set('type', 'ERC-721,ERC-1155');
      url = `${base}/api/v2/addresses/${address}/nft?${qs}`;
    } else {
      url = null;
    }
  }
  return out.slice(0, limit);
}

module.exports = { getAccountNfts, supportsChain, explorerBase, EXPLORERS };
