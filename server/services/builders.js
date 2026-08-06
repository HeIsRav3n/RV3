'use strict';

const { ethers } = require('ethers');
const config = require('../config');

const RELAY_URL = 'https://relay.flashbots.net';
const BROADCAST_TIMEOUT = 8000;

/**
 * Secure builder fan-out: only ever sends already-signed raw txs over HTTPS.
 * Private keys never leave the server except as signatures on bundle auth headers.
 */

async function rpcSendRaw(url, signedTx, timeout = BROADCAST_TIMEOUT) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: [signedTx], id: 1,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'RPC rejected');
  return j.result;
}

/** First successful response wins — does not wait for slow endpoints. */
async function raceSendRaw(signedTx, urls, timeout = BROADCAST_TIMEOUT) {
  const list = [...new Set(urls.filter(u => u?.startsWith('https://')))];
  if (!list.length) throw new Error('No builder/RPC URLs configured');

  return new Promise((resolve, reject) => {
    let pending = list.length;
    const errors = [];

    for (const url of list) {
      rpcSendRaw(url, signedTx, timeout)
        .then(hash => resolve({ hash, url }))
        .catch(e => {
          errors.push(`${url.slice(0, 40)}: ${e.message}`);
          if (--pending === 0) {
            reject(new Error(errors.slice(0, 4).join(' | ') || 'All builders rejected tx'));
          }
        });
    }
  });
}

async function signFlashbotsPayload(body, authKey) {
  const wallet = new ethers.Wallet(authKey);
  const bodyStr = JSON.stringify(body);
  const sig = await wallet.signMessage(ethers.id(bodyStr));
  return `${await wallet.getAddress()}:${sig}`;
}

async function fetchBlockNumber(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    signal: AbortSignal.timeout(3000),
  });
  const j = await res.json();
  return parseInt(j.result, 16);
}

/** Single eth_sendBundle call to the Flashbots relay for one target block. */
async function relaySendBundle(signedTxs, blockNumber, key) {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'eth_sendBundle',
    params: [{ txs: signedTxs, blockNumber: '0x' + BigInt(blockNumber).toString(16) }],
  };
  const signature = await signFlashbotsPayload(body, key);
  const res = await fetch(RELAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flashbots-Signature': signature,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BROADCAST_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Flashbots relay HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'bundle rejected');
  return j.result?.bundleHash || null;
}

/**
 * Submit signed tx as Flashbots bundle to relay + optional builder RPC endpoints.
 * Returns hash from first successful path.
 */
async function sendBundle(signedTx, opts = {}) {
  const { targetBlock, authKey } = opts;
  const key = authKey || config.flashbotsAuthKey;
  const urls = config.builderRpcs.map(b => b.url);

  const tasks = [];

  if (key) {
    tasks.push((async () => {
      let block;
      if (targetBlock != null) block = Number(targetBlock);
      else if (urls[0]) block = await fetchBlockNumber(urls[0]) + 1;
      else throw new Error('No RPC for target block');

      const bundleHash = await relaySendBundle([signedTx], block, key);
      return { hash: ethers.keccak256(signedTx), url: RELAY_URL, bundleHash };
    })());
  }

  if (urls.length) {
    tasks.push(raceSendRaw(signedTx, urls).then(r => ({ ...r, via: 'builder_rpc' })));
  }

  if (!tasks.length) {
    throw new Error('Flashbots bundle requires FLASHBOTS_AUTH_PRIVATE_KEY or builder RPC URLs');
  }

  return Promise.any(tasks);
}

/**
 * Atomic multi-wallet bundle — all signed txs land in ONE block or not at all.
 * Targets the next `blocks` blocks in parallel (Flashbots drops non-winning
 * targets for free), so a busy block doesn't kill the attempt.
 * Returns tx hashes plus the targeted block range.
 */
async function sendBundleMulti(signedTxs, opts = {}) {
  const { rpcUrl, targetBlock, blocks = 4, authKey } = opts;
  const key = authKey || config.flashbotsAuthKey;
  if (!key) throw new Error('Atomic bundle requires FLASHBOTS_AUTH_PRIVATE_KEY');
  if (!Array.isArray(signedTxs) || !signedTxs.length) throw new Error('No signed txs to bundle');

  const readUrl = rpcUrl || config.builderRpcs[0]?.url;
  let base;
  if (targetBlock != null) base = Number(targetBlock) - 1;
  else if (readUrl) base = await fetchBlockNumber(readUrl);
  else throw new Error('No RPC for target block');

  const targets = Array.from({ length: blocks }, (_, i) => base + 1 + i);
  const results = await Promise.allSettled(targets.map(b => relaySendBundle(signedTxs, b, key)));
  const okCount = results.filter(r => r.status === 'fulfilled').length;
  if (!okCount) {
    const first = results.find(r => r.status === 'rejected');
    throw new Error(`bundle rejected for all ${blocks} target blocks: ${first?.reason?.message || 'unknown'}`);
  }

  return {
    hashes: signedTxs.map(t => ethers.keccak256(t)),
    bundleHashes: results.filter(r => r.status === 'fulfilled').map(r => r.value),
    targetBlocks: targets,
    submitted: okCount,
  };
}

module.exports = { raceSendRaw, rpcSendRaw, sendBundle, sendBundleMulti, relaySendBundle, RELAY_URL };
