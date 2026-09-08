'use strict';

const { assertExternalSignerConfigured } = require('./signerProvider');

async function getNftsForWallet() {
  throw new Error('NFT discovery requires a configured read-only provider flow.');
}

async function runSweepOp() { assertExternalSignerConfigured(); }

module.exports = { runSweepOp, getNftsForWallet };
