'use strict';

const { assertExternalSignerConfigured } = require('./signerProvider');

const RELAY_URL = 'https://relay.flashbots.net';

// Private relay authentication must be supplied by the future external signer,
// not an environment private key held by this process.
async function raceSendRaw() { assertExternalSignerConfigured(); }
async function rpcSendRaw() { assertExternalSignerConfigured(); }
async function sendBundle() { assertExternalSignerConfigured(); }
async function sendBundleMulti() { assertExternalSignerConfigured(); }
async function relaySendBundle() { assertExternalSignerConfigured(); }

module.exports = { raceSendRaw, rpcSendRaw, sendBundle, sendBundleMulti, relaySendBundle, RELAY_URL };
