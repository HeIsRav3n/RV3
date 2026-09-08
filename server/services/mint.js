'use strict';

const { assertExternalSignerConfigured } = require('./signerProvider');

// Intentionally fail closed until an approved external SignerProvider can sign
// validated unsigned transactions without exposing private keys to this server.
async function runMintTask() { assertExternalSignerConfigured(); }
async function executeMintForWallet() { assertExternalSignerConfigured(); }
async function runBundleMintTask() { assertExternalSignerConfigured(); }
async function signMintForWallet() { assertExternalSignerConfigured(); }

module.exports = { runMintTask, executeMintForWallet, runBundleMintTask, signMintForWallet };
