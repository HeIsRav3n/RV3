'use strict';

const { assertExternalSignerConfigured } = require('./signerProvider');

// Funding formerly constructed server-held signing wallets. That custodial
// path is removed; a provider-backed unsigned-transaction flow is
// required before it can execute again.
async function runFundOp() { assertExternalSignerConfigured(); }

module.exports = { runFundOp };
