'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../server/services/productionPolicy');

const env = {
  RV3_EXTERNAL_SIGNER_PROVIDER: 'hardware-wallet',
  RV3_ALLOWED_CHAINS: 'ethereum,robinhood',
  RV3_ALLOWED_CONTRACTS: '0x1111111111111111111111111111111111111111',
  RV3_MAX_TX_VALUE_WEI: '10000000000000000',
  RV3_DAILY_SPEND_WEI: '50000000000000000',
  RV3_CIRCUIT_BREAKER: 'off',
};

test('production policy accepts an allowlisted chain and contract', () => {
  const current = policy.readPolicy(env);
  assert.doesNotThrow(() => policy.assertTaskAllowed({ chainSlug: 'ethereum', contractAddress: '0x1111111111111111111111111111111111111111' }, current));
});

test('production policy rejects non-allowlisted execution', () => {
  const current = policy.readPolicy(env);
  assert.throws(() => policy.assertTaskAllowed({ chainSlug: 'polygon', contractAddress: '0x1111111111111111111111111111111111111111' }, current), /allowlisted/);
});

test('signature requests require a matching chain, approval, and idempotency key', () => {
  const current = policy.readPolicy(env);
  assert.doesNotThrow(() => policy.assertSignatureRequest({ from: '0x2222222222222222222222222222222222222222', chain: 'ethereum', chainId: 1, approvalId: 'approval_123', idempotencyKey: 'intent_123' }, current));
  assert.throws(() => policy.assertSignatureRequest({ from: '0x2222222222222222222222222222222222222222', chain: 'ethereum', chainId: 8453, approvalId: 'approval_123', idempotencyKey: 'intent_123' }, current), /chain ID/);
});
