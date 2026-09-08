'use strict';

const config = require('../config');

function subgraphId(chain) {
  const normalized = String(chain || '').toLowerCase();
  if (normalized === 'ethereum') return config.theGraphEthereumSubgraph;
  if (normalized === 'robinhood') return config.theGraphRobinhoodSubgraph;
  return '';
}

function endpoint(chain) {
  const id = subgraphId(chain);
  if (!config.theGraphApiKey || !id) return null;
  return `https://gateway.thegraph.com/api/subgraphs/id/${encodeURIComponent(id)}`;
}

async function query(chain, queryText, variables = {}) {
  const url = endpoint(chain);
  if (!url) throw new Error(`The Graph is not configured for ${chain}.`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.theGraphApiKey}` },
    body: JSON.stringify({ query: queryText, variables }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) throw new Error(`The Graph request failed${res.status ? ` (${res.status})` : ''}`);
  return body.data;
}

async function health(chain) {
  const url = endpoint(chain);
  if (!url) return { configured: false, chain, mode: 'not_configured' };
  const start = Date.now();
  await query(chain, 'query RV3Health { _meta { block { number } } }');
  return { configured: true, chain, ms: Date.now() - start };
}

module.exports = { endpoint, query, health };
