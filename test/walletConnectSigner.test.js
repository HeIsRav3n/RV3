'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const signer = require('../server/services/walletConnectSigner');

test('WalletConnect signer exposes only reviewed Ethereum and Robinhood pairing', () => {
  const status = signer.status();
  assert.deepEqual(status.chains, ['ethereum', 'robinhood']);
  assert.equal(status.connected, false);
  assert.equal(status.pairingPending, false);
});

test('WalletConnect signer rejects transactions before an approved session', async () => {
  await assert.rejects(
    signer.requestTransaction({
      chain: 'ethereum',
      transaction: { from: '0x1', to: '0x2', data: '0x' },
    }),
    /No approved WalletConnect wallet session is active/,
  );
});
