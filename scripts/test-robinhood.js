'use strict';
// Live smoke test: Robinhood RPC balance + Blockscout NFT discovery + module loads.

const rpc = require('../server/services/rpc');
const blockscout = require('../server/services/blockscout');
require('../server/services/sweep');
require('../server/services/fund');

const assert = require('node:assert');

(async () => {
  // 1. Chain resolution + RPC urls
  assert.strictEqual(rpc.normalizeChain('robinhood'), 'robinhood');
  const urls = rpc.allRpcUrls([], 'robinhood');
  assert.ok(urls.length >= 1, 'robinhood RPC urls');
  console.log('[1] robinhood RPC urls:', urls);

  // 2. Live balance read on Robinhood chain
  const url = await rpc.getFastestUrl(urls);
  const bal = await rpc.getBalance(url, '0x0000000000000000000000000000000000000000');
  assert.ok(typeof bal === 'number' && bal >= 0, 'balance is a number');
  console.log('[2] balance(0x0) on robinhood =', bal, 'ETH via', url);

  // 3. Blockscout NFT discovery (zero address — validates API + parsing)
  assert.ok(blockscout.supportsChain('robinhood'));
  assert.ok(!blockscout.supportsChain('ethereum'));
  const nfts = await blockscout.getAccountNfts('robinhood', '0x0000000000000000000000000000000000000001');
  assert.ok(Array.isArray(nfts), 'nft list is array');
  console.log('[3] blockscout NFTs for 0x…01:', nfts.length, nfts.slice(0, 3));

  // 4. Gas estimate for a plain transfer on Robinhood (fund path)
  const est = await rpc.estimateGas(url, {
    from: '0x000000000000000000000000000000000000dEaD',
    to: '0x0000000000000000000000000000000000000001',
    data: '0x', value: 0n,
  });
  assert.ok(est >= 21000n, 'transfer gas >= 21000');
  console.log('[4] plain transfer gas estimate on robinhood =', est.toString());

  console.log('ALL ROBINHOOD SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
