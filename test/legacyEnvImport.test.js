const test = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('../scripts/import-legacy-env');

test('legacy import keeps Neon and excludes server signing controls', () => {
  const existing = { DATABASE_URL: 'postgres://current-neon', ENABLE_LIVE_MINT: 'false' };
  const legacy = {
    OPENSEA_API_KEY: 'legacy-opensea-key',
    ETH_RPC_PRIMARY: 'https://provider.example/rpc',
    WALLET_ENCRYPTION_KEY: 'must-not-move',
    FLASHBOTS_AUTH_PRIVATE_KEY: 'must-not-move',
    ENABLE_LIVE_MINT: 'true',
    DATABASE_URL: 'postgres://legacy-db'
  };
  const result = merge(existing, legacy);
  assert.equal(existing.DATABASE_URL, 'postgres://current-neon');
  assert.equal(existing.ENABLE_LIVE_MINT, 'false');
  assert.equal(existing.OPENSEA_API_KEY, 'legacy-opensea-key');
  assert.equal(existing.ETH_RPC_PRIMARY, 'https://provider.example/rpc');
  assert.equal(existing.WALLET_ENCRYPTION_KEY, undefined);
  assert.deepEqual(result.skipped.sort(), [
    'DATABASE_URL', 'ENABLE_LIVE_MINT', 'FLASHBOTS_AUTH_PRIVATE_KEY', 'WALLET_ENCRYPTION_KEY'
  ]);
});
