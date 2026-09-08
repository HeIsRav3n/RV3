'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gql = require('../server/services/gql');
const opensea = require('../server/services/opensea');

test('OpenSea GraphQL is disabled unless explicitly opted in', async () => {
  await assert.rejects(() => gql.gqlFetch('query Test { __typename }'), /GraphQL is disabled/);
});

test('OpenSea REST helpers normalize supported chain aliases', () => {
  assert.equal(opensea.chainSlug('ETH'), 'ethereum');
  assert.equal(opensea.chainSlug('matic'), 'polygon');
  assert.equal(opensea.chainSlug('robinhood-chain'), 'robinhood');
});
