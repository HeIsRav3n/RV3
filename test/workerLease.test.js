'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lease = require('../server/services/workerLease');

test('worker lease has a stable process holder identity', () => {
  assert.match(lease.HOLDER, /^rv3-/);
});
