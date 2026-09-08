'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTaskInput, summary } = require('../server/services/readiness');

test('validates supported multi-chain task scheduling modes', () => {
  const block = validateTaskInput({ chainSlug: 'base', contractAddress: '0x1111111111111111111111111111111111111111', targetBlock: 123 });
  assert.equal(block.chainSlug, 'base');
  assert.equal(block.targetBlock, 123);
  assert.throws(() => validateTaskInput({ chainSlug: 'base', targetBlock: 2, scheduledAt: '2030-01-01T00:00:00Z' }));
  assert.throws(() => validateTaskInput({ chainSlug: 'base', contractAddress: 'not-an-address' }));
});

test('readiness checklist fails closed without a signer and policy', () => {
  const result = summary({ id: 't1', chainSlug: 'polygon', contractAddress: '0x1111111111111111111111111111111111111111', wallets: 1, executionApproved: false }, [{ id: 'w1', address: '0x2222222222222222222222222222222222222222' }]);
  assert.equal(result.chain, 'polygon');
  assert.equal(result.readyForLive, false);
  assert.equal(result.checks.find(c => c.id === 'signer').ok, false);
  assert.equal(result.checks.find(c => c.id === 'confirmation').ok, false);
});
