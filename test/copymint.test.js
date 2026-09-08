'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const copy = require('../server/services/copymint');

test('copy-mint only accepts Ethereum and Robinhood public free-mint targets', async () => {
  await assert.rejects(() => copy.addTarget({ address: '0x1111111111111111111111111111111111111111', chain: 'base' }), /Ethereum and Robinhood/);
  const target = await copy.addTarget({ address: '0x1111111111111111111111111111111111111111', chain: 'ethereum', label: 'test' });
  assert.equal(target.mode, 'free_public_preflight');
  const ignored = await copy.observePublicMint({ chain: 'ethereum', isPublic: true, priceWei: '1', contractAddress: target.address, openseaSlug: 'example' });
  assert.equal(ignored.queued, false);
  await copy.removeTarget(target.id);
});
