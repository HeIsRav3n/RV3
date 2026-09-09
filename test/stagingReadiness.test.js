'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stagingReadiness } = require('../scripts/staging-readiness');

const baseConfig = {
  apiSecret: 'a'.repeat(32), dataDir: './data', openseaApiKey: 'configured',
  envRpcs: [{ fromEnv: true }], walletConnectProjectId: 'configured',
  theGraphApiKey: 'graph-key', theGraphEthereumSubgraph: 'subgraph', eventProvider: 'provider',
};

test('staging readiness reports production blockers without enabling live execution', () => {
  const report = stagingReadiness({ DATABASE_URL: 'postgres://db' }, baseConfig);
  assert.equal(report.ready, false);
  assert.ok(report.productionErrors.some(error => error.includes('RV3_ALLOWED_CONTRACTS')));
  assert.equal(report.checks.find(check => check.id === 'contracts').ready, false);
});

test('staging readiness accepts a fully configured external-signer release', () => {
  const env = {
    DATABASE_URL: 'postgres://db', RV3_EXTERNAL_SIGNER_PROVIDER: 'walletconnect',
    WALLETCONNECT_PROJECT_ID: 'configured', RV3_PUBLIC_URL: 'https://rv3.example',
    RV3_ALLOWED_CHAINS: 'ethereum,robinhood', RV3_ALLOWED_CONTRACTS: '0x1111111111111111111111111111111111111111',
    RV3_MAX_TX_VALUE_WEI: '1', RV3_DAILY_SPEND_WEI: '2',
  };
  const report = stagingReadiness(env, baseConfig);
  assert.equal(report.ready, true);
  assert.ok(report.checks.every(check => check.ready));
});
