#!/usr/bin/env node
'use strict';

const config = require('../server/config');
const { validateProductionConfig } = require('../server/config/validateProductionConfig');

function stagingReadiness(env, runtimeConfig) {
  const liveConfig = { ...runtimeConfig, env: 'production', enableLiveMint: true };
  const productionErrors = validateProductionConfig(env, liveConfig);
  const checks = [
    { id: 'database', ready: Boolean(env.DATABASE_URL), label: 'Durable PostgreSQL database' },
    { id: 'opensea', ready: Boolean(runtimeConfig.openseaApiKey), label: 'OpenSea REST API' },
    { id: 'rpc', ready: runtimeConfig.envRpcs.length > 0, label: 'Approved provider RPC' },
    { id: 'walletconnect', ready: Boolean(env.WALLETCONNECT_PROJECT_ID), label: 'WalletConnect project' },
    { id: 'public-origin', ready: /^https:\/\//i.test(String(env.RV3_PUBLIC_URL || '')), label: 'Final HTTPS operator origin' },
    { id: 'contracts', ready: Boolean(env.RV3_ALLOWED_CONTRACTS), label: 'Contract allowlist' },
    { id: 'spend-caps', ready: Boolean(env.RV3_MAX_TX_VALUE_WEI) && Boolean(env.RV3_DAILY_SPEND_WEI), label: 'Transaction and daily spend caps' },
    { id: 'the-graph', ready: Boolean(runtimeConfig.theGraphApiKey && runtimeConfig.theGraphEthereumSubgraph), label: 'The Graph indexed reads' },
    { id: 'event-provider', ready: Boolean(runtimeConfig.eventProvider), label: 'Read-only event provider' },
  ];
  return { ready: productionErrors.length === 0, checks, productionErrors };
}

function main() {
  const report = stagingReadiness(process.env, config);
  for (const check of report.checks) console.log(`${check.ready ? 'PASS' : 'BLOCKED'}  ${check.label}`);
  if (report.productionErrors.length) {
    console.log(`\nLive activation is blocked by ${report.productionErrors.length} required configuration gate(s).`);
    process.exitCode = 1;
  } else {
    console.log('\nStaging configuration is ready for an operator-controlled validation run.');
  }
}

if (require.main === module) main();

module.exports = { stagingReadiness };
