'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rpc = require('../server/services/rpc');

test('RPC selection ignores untrusted task and query endpoints', () => {
  const urls = rpc.allRpcUrls(['https://untrusted.example.invalid/rpc'], 'ethereum');
  assert.ok(urls.length > 0);
  assert.equal(urls.includes('https://untrusted.example.invalid/rpc'), false);
});
