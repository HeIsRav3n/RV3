'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReservation } = require('../server/services/policyStore');

test('durable approval reservation rejects missing identity before database access', () => {
  assert.throws(() => validateReservation({}, { maxTxValueWei: 1n }), /Durable PostgreSQL/);
});
