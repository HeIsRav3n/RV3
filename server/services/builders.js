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
      const wallet = new ethers.Wallet(key);
      let blockHex;
      if (targetBlock != null) {
        blockHex = '0x' + BigInt(targetBlock).toString(16);
      } else if (urls[0]) {
        const bn = await fetch(urls[0], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
          signal: AbortSignal.timeout(3000),
        }).then(r => r.json()).then(j => j.result);
        blockHex = '0x' + (parseInt(bn, 16) + 1).toString(16);
      } else {
        throw new Error('No RPC for target block');
      }

      const body = {
        jsonrpc: '2.0', id: 1, method: 'eth_sendBundle',
        params: [{ txs: [signedTx], blockNumber: blockHex }],
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
      const txHash = ethers.keccak256(signedTx);
      return { hash: txHash, url: RELAY_URL, bundleHash: j.result?.bundleHash };
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

module.exports = { raceSendRaw, rpcSendRaw, sendBundle, RELAY_URL };
