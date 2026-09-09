'use strict';

const rpc = require('./rpc');

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function assertWatchOnlyAddress(address) {
  const normalized = String(address || '').trim();
  if (!ADDRESS.test(normalized)) throw new Error('A valid wallet address is required. RV3 never accepts private keys.');
  return normalized;
}

async function inspect(address, chain = 'ethereum', rpcClient = rpc) {
  const wallet = assertWatchOnlyAddress(address);
  const chainSlug = rpcClient.normalizeChain(chain);
  const urls = rpcClient.allRpcUrls([], chainSlug);
  if (!urls.length) throw new Error(`No approved RPC endpoint is configured for ${chainSlug}.`);
  const url = await rpcClient.getFastestUrl(urls);
  const [balanceEth, transaction] = await Promise.all([
    rpcClient.getBalance(url, wallet),
    rpcClient.getWalletNonceAndChain(url, wallet),
  ]);
  return {
    address: wallet,
    chain: chainSlug,
    balanceEth,
    pendingNonce: transaction.nonce,
    chainId: transaction.chainId.toString(),
  };
}

module.exports = { assertWatchOnlyAddress, inspect };
