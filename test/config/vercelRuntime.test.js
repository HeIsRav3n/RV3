'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLiveMint } = require('../../server/config');

test('Vercel always runs RV3 in preflight-only mode', () => {
  assert.equal(resolveLiveMint({ VERCEL: '1', ENABLE_LIVE_MINT: 'true' }), false);
});

test('persistent hosts may opt into live mode only through configuration', () => {
  assert.equal(resolveLiveMint({ ENABLE_LIVE_MINT: 'true' }), true);
  assert.equal(resolveLiveMint({ ENABLE_LIVE_MINT: 'false' }), false);
});
