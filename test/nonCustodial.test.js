'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const signer = require('../server/services/signerProvider');

test('external signer boundary fails closed until a provider is integrated', () => {
  assert.throws(() => signer.assertExternalSignerConfigured(), /external SignerProvider/);
});

test('SignerProvider does not implement server-side signing', async () => {
  const provider = new signer.SignerProvider();
  await assert.rejects(provider.signTransaction({}), /not configured/);
});
