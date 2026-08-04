'use strict';

const { ethers } = require('ethers');
const config = require('../config');
const rpc = require('./rpc');
const routes = require('./routes');
const builders = require('./builders');

const GAS_PRESETS = { slow: 3, normal: 7, fast: 15, turbo: 25 };

function gweiFromPreset(preset, custom) {
  if (preset === 'custom' && custom) return Math.min(Math.max(parseFloat(custom) || 7, 1), 999);
  return GAS_PRESETS[preset] || GAS_PRESETS.normal;
}

function pickSendUrls(route, extra = [], chainSlug = 'ethereum') {
  const normalized = routes.normalizeRoute(route);
  const all = rpc.allRpcUrls(extra, chainSlug);

  // Flashbots relay + builder fan-out are Ethereum-mainnet only. On any other
  // chain (Base, Blast, Polygon, Robinhood) fall back to direct RPC broadcast.
  if (rpc.normalizeChain(chainSlug) !== 'ethereum') return all;

  const privateRpc = rpc.getPrivateRpc(chainSlug);

  if (normalized === routes.ROUTES.FB_PROTECT) {
    return privateRpc ? [privateRpc.url] : all.slice(0, 1);
  }

  if (normalized === routes.ROUTES.FB_BUNDLE) {
    const builderUrls = config.builderRpcs.map(b => b.url);
    const combined = [...new Set([...(privateRpc ? [privateRpc.url] : []), ...builderUrls, ...all])];
    return combined.length ? combined : all.slice(0, 1);
  }

  if (normalized === routes.ROUTES.PUBLIC) {
    return all.filter(u => !privateRpc || u !== privateRpc.url);
  }

  return all.length ? all : [];
}

/**
 * Broadcast signed tx — race mode returns on first success (sub-ms perceived latency).
 */
async function broadcastRaw(signedTx, urls, opts = {}) {
  const { blast = true, route, targetBlock } = opts;
  const list = blast ? urls : urls.slice(0, 1);
  if (!list.length) throw new Error('No RPC endpoints configured');

  const normalized = routes.normalizeRoute(route);

  if (normalized === routes.ROUTES.FB_BUNDLE) {
    const result = await builders.sendBundle(signedTx, { targetBlock });
    return result.hash;
  }

  const { hash } = await builders.raceSendRaw(signedTx, list);
  return hash;
}

/**
 * Build and sign a transaction without broadcasting.
 * Single batch RPC call: nonce + chainId + baseFee from latest block.
 * Dynamic gas: maxFeePerGas auto-bumps above current baseFee so tx always lands.
 * feeHeadroom: multiplier applied to baseFee (1.25 = normal, 2.0 = prewarm buffer)
 */
async function buildAndSign(signer, txRequest, opts = {}) {
  const { rpcUrl, gasGwei = 20, feeHeadroom = 1.25 } = opts;
  const gasLimit = BigInt(txRequest.gasLimit ?? 350000);
  const address = await signer.getAddress();

  const { nonce, chainId, baseFeeGwei } = await rpc.getWalletNonceAndChain(rpcUrl, address);

  // tip = small priority fee so miners prefer our tx; capped at 2.5 gwei
  const tip = Math.min(Math.max(gasGwei * 0.12, 1), 2.5);
  // maxFeePerGas must exceed baseFee + tip; also honour the user's preset floor
  const autoFee = baseFeeGwei ? baseFeeGwei * feeHeadroom + tip : gasGwei;
  const maxFee = Math.max(autoFee, gasGwei);

  const builtTx = {
    to: txRequest.to,
    data: txRequest.data || '0x',
    value: txRequest.value ?? 0n,
    nonce, chainId, gasLimit, type: 2,
    maxFeePerGas: ethers.parseUnits(maxFee.toFixed(4), 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(tip.toFixed(4), 'gwei'),
  };

  const signed = await signer.signTransaction(builtTx);
  return { signed, nonce, chainId, baseFeeGwei, maxFee };
}

async function sendTx(signer, txRequest, opts = {}) {
  const {
    route = routes.ROUTES.DIRECT_RPC,
    rpcUrls = [],
    chainSlug = 'ethereum',
    gasGwei = 20,
    blast = true,
    wait = true,
    timeout = 120000,
    simulate = true,
  } = opts;

  const urls = pickSendUrls(route, rpcUrls, chainSlug);
  if (!urls.length) throw new Error('No RPC endpoints configured');

  const minter = await signer.getAddress();
  const fastest = await rpc.getFastestUrl(urls);

  if (simulate) {
    const hexValue = '0x' + (txRequest.value ?? 0n).toString(16);
    await rpc.simulateCall(fastest, minter, txRequest.to, txRequest.data, hexValue);
  }

  const start = Date.now();
  const { signed } = await buildAndSign(signer, txRequest, { rpcUrl: fastest, gasGwei });
  const hash = await broadcastRaw(signed, urls, { blast, route: routes.normalizeRoute(route) });

  if (!wait) return { hash, receipt: null, confirmMs: Date.now() - start };

  const provider = new ethers.JsonRpcProvider(fastest);
  const receipt = await provider.waitForTransaction(hash, 1, timeout);
  if (!receipt || receipt.status === 0) throw new Error('Transaction reverted on-chain');
  return { hash, receipt, confirmMs: Date.now() - start };
}

async function estimateGasCostEth(gasGwei, gasLimit = 200000) {
  const fee = ethers.parseUnits(String(gasGwei), 'gwei') * BigInt(gasLimit);
  return parseFloat(ethers.formatEther(fee));
}

module.exports = {
  sendTx, buildAndSign, broadcastRaw, gweiFromPreset, pickSendUrls,
  estimateGasCostEth, GAS_PRESETS,
};
