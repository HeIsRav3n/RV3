'use strict';

const { UniversalProvider } = require('@walletconnect/universal-provider');
const config = require('../config');
const { CHAIN_IDS } = require('./productionPolicy');

const SUPPORTED_CHAINS = Object.freeze(['ethereum', 'robinhood']);
let provider = null;
let session = null;
let pairingUri = null;
let lastError = null;

function configured() { return Boolean(config.walletConnectProjectId); }

function activeSession() {
  if (session?.expiry && Number(session.expiry) * 1000 <= Date.now()) {
    session = null;
    pairingUri = null;
    lastError = 'The WalletConnect session expired; pair the operator wallet again.';
  }
  return session;
}

function status() {
  const current = activeSession();
  return {
    configured: configured(),
    connected: Boolean(current?.topic),
    pairingPending: Boolean(pairingUri && !current?.topic),
    chains: SUPPORTED_CHAINS,
    lastError,
  };
}

async function client() {
  if (!configured()) throw new Error('WALLETCONNECT_PROJECT_ID is required before pairing an external wallet.');
  if (provider) return provider;
  provider = await UniversalProvider.init({
    projectId: config.walletConnectProjectId,
    metadata: {
      name: 'RV3',
      description: 'RV3 reviewed external-signing requests',
      url: config.publicUrl || 'http://localhost:3000',
      icons: [],
    },
  });
  provider.on('display_uri', uri => { pairingUri = uri; });
  provider.on('session_delete', () => { session = null; pairingUri = null; });
  return provider;
}

async function beginPairing() {
  const wc = await client();
  if (activeSession()?.topic) return { connected: true };
  lastError = null;
  const namespaces = {
    eip155: {
      chains: SUPPORTED_CHAINS.map(chain => `eip155:${CHAIN_IDS[chain]}`),
      methods: ['eth_sendTransaction'],
      events: ['accountsChanged', 'chainChanged'],
    },
  };
  const { uri, approval } = await wc.connect({ optionalNamespaces: namespaces });
  pairingUri = uri || pairingUri;
  approval().then(approved => {
    session = approved;
    pairingUri = null;
  }).catch(error => { lastError = error.message; });
  return { connected: false, uri: pairingUri, expiresInSeconds: 300 };
}

function assertConnectedTransaction(input) {
  const chain = String(input?.chain || '').toLowerCase();
  if (!SUPPORTED_CHAINS.includes(chain)) throw new Error('WalletConnect signer supports only Ethereum and Robinhood Chain.');
  if (!activeSession()?.topic) throw new Error('No approved WalletConnect wallet session is active.');
  const transaction = input?.transaction;
  if (!transaction?.from || !transaction?.to || !transaction?.data) throw new Error('A complete reviewed transaction is required.');
  return { chain, transaction };
}

async function requestTransaction(input) {
  const { chain, transaction } = assertConnectedTransaction(input);
  const wc = await client();
  // The wallet receives the full request and retains the sole ability to approve,
  // sign, and broadcast it. RV3 never receives a private key or raw signature.
  return wc.request({
    topic: session.topic,
    chainId: `eip155:${CHAIN_IDS[chain]}`,
    request: { method: 'eth_sendTransaction', params: [transaction] },
  });
}

module.exports = { configured, status, beginPairing, requestTransaction };
