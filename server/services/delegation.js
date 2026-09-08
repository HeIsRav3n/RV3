'use strict';

const { assertExternalSignerConfigured } = require('./signerProvider');
const rpc = require('./rpc');
const tx = require('./tx');

async function connect(chain, extraRpcs = []) {
  const normalized = rpc.normalizeChain(chain);
  const urls = tx.pickSendUrls('DIRECT RPC', extraRpcs, normalized);
  if (!urls.length) throw new Error(`No RPC configured for ${normalized}`);
  return { chain: normalized, url: await rpc.getFastestUrl(urls) };
}

async function contractBalance(deployment, rpcUrls = []) {
  const { url } = await connect(deployment.chain, rpcUrls);
  return rpc.getBalance(url, deployment.address);
}

async function deploy() { assertExternalSignerConfigured(); }
async function batchMint() { assertExternalSignerConfigured(); }
async function sweep() { assertExternalSignerConfigured(); }
async function withdraw() { assertExternalSignerConfigured(); }

module.exports = { deploy, batchMint, sweep, withdraw, contractBalance, ABI: [] };
