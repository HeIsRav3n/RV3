'use strict';
// Smoke test: atomic bundle plumbing + hot-path getFastestUrl latency.

const assert = require('node:assert');
const rpc = require('../server/services/rpc');
const builders = require('../server/services/builders');
const mint = require('../server/services/mint');

(async () => {
  // 1. New exports exist
  assert.strictEqual(typeof builders.sendBundleMulti, 'function');
  assert.strictEqual(typeof builders.relaySendBundle, 'function');
  assert.strictEqual(typeof mint.runBundleMintTask, 'function');
  assert.strictEqual(typeof mint.signMintForWallet, 'function');
  console.log('[1] exports OK');

  // 2. sendBundleMulti input validation
  await assert.rejects(
    () => builders.sendBundleMulti([], { authKey: '0x' + '1'.repeat(64) }),
    /No signed txs/);
  console.log('[2] sendBundleMulti validation OK');

  // 3. getFastestUrl: cold path (race) then hot path (cached, ~0ms)
  const urls = rpc.allRpcUrls([], 'ethereum');
  assert.ok(urls.length >= 1);
  const t0 = Date.now();
  const first = await rpc.getFastestUrl(urls);
  const coldMs = Date.now() - t0;
  const t1 = Date.now();
  const second = await rpc.getFastestUrl(urls);
  const hotMs = Date.now() - t1;
  assert.ok(first.startsWith('https://') && second.startsWith('https://'));
  assert.ok(hotMs <= 50, `hot path should be instant, took ${hotMs}ms`);
  console.log(`[3] getFastestUrl cold=${coldMs}ms hot=${hotMs}ms → ${second}`);

  console.log('ALL BUNDLE SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
