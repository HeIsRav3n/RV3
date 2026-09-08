'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../server/services/theGraph');

test('The Graph endpoint fails closed without server-side configuration', () => {
  assert.equal(graph.endpoint('ethereum'), null);
  assert.equal(graph.endpoint('robinhood'), null);
});
