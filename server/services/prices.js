'use strict';

let cache = { usd: 0, at: 0 };

async function getEthUsd() {
  if (cache.usd && Date.now() - cache.at < 60000) return cache.usd;
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    { signal: AbortSignal.timeout(5000) }
  );
  const data = await res.json();
  const usd = data?.ethereum?.usd;
  if (usd) {
    cache = { usd, at: Date.now() };
    return usd;
  }
  return cache.usd || 0;
}

module.exports = { getEthUsd };
