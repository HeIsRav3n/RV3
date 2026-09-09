'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertWatchOnlyAddress, inspect } = require('../server/services/walletObservation');

const address = '0x1111111111111111111111111111111111111111';

test('wallet observation rejects private-key shaped input and accepts an address', () => {
  assert.throws(() => assertWatchOnlyAddress('0x1234'), /valid wallet address/);
  assert.equal(assertWatchOnlyAddress(address), address);
});

test('wallet observation reads balance and pending nonce from approved RPC only', async () => {
  const seen = [];
  const fakeRpc = {
    normalizeChain: () => 'ethereum',
    allRpcUrls: (extra, chain) => { seen.push({ extra, chain }); return ['https://approved.example/rpc']; },
    getFastestUrl: async urls => urls[0],
    getBalance: async () => 1.25,
    getWalletNonceAndChain: async () => ({ nonce: 7, chainId: 1n }),
  };
  const result = await inspect(address, 'ethereum', fakeRpc);
  assert.equal(result.balanceEth, 1.25);
  assert.equal(result.pendingNonce, 7);
  assert.equal(result.chainId, '1');
  assert.deepEqual(seen, [{ extra: [], chain: 'ethereum' }]);
});
