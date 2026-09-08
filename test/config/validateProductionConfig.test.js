'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionConfig } = require('../../server/config/validateProductionConfig');

const liveConfig = (overrides = {}) => ({
  env: 'production',
  enableLiveMint: true,
  apiSecret: 'a'.repeat(32),
  dataDir: '/srv/rv3/data',
  envRpcs: [{ fromEnv: true }],
  ...overrides,
});
const liveEnv = (overrides = {}) => ({
  DATABASE_URL: 'postgres://db.example/rv3',
  RV3_EXTERNAL_SIGNER_PROVIDER: 'walletconnect',
  WALLETCONNECT_PROJECT_ID: 'rv3_walletconnect_project',
  RV3_PUBLIC_URL: 'https://rv3.example.com',
  RV3_ALLOWED_CHAINS: 'ethereum',
  RV3_ALLOWED_CONTRACTS: '0x1111111111111111111111111111111111111111',
  RV3_MAX_TX_VALUE_WEI: '10000000000000000',
  RV3_DAILY_SPEND_WEI: '50000000000000000',
  ...overrides,
});

test('allows explicitly configured live production execution', () => {
  assert.deepEqual(validateProductionConfig(liveEnv(), liveConfig()), []);
});

test('blocks missing durable database', () => {
  assert.match(validateProductionConfig({}, liveConfig()).join(' '), /DATABASE_URL/);
});

test('blocks placeholder secret', () => {
  const errors = validateProductionConfig(
    liveEnv(),
    liveConfig({ apiSecret: 'change_me' }),
  );
  assert.match(errors.join(' '), /API_SECRET/);
});

test('blocks serverless, ephemeral, and default-only RPC live execution', () => {
  const errors = validateProductionConfig(
    liveEnv({ VERCEL: '1' }),
    liveConfig({ dataDir: '/tmp', envRpcs: [{ fromEnv: false }] }),
  );
  assert.match(errors.join(' '), /serverless/);
  assert.match(errors.join(' '), /environment configuration/);
});

test('blocks an unsupported signer or WalletConnect without a production origin', () => {
  const unsupported = validateProductionConfig(liveEnv({ RV3_EXTERNAL_SIGNER_PROVIDER: 'unknown' }), liveConfig());
  assert.match(unsupported.join(' '), /supported non-custodial signer/);
  const missingOrigin = validateProductionConfig(liveEnv({ RV3_PUBLIC_URL: '' }), liveConfig());
  assert.match(missingOrigin.join(' '), /RV3_PUBLIC_URL/);
});

test('does not block preflight-only production mode', () => {
  assert.deepEqual(validateProductionConfig({}, liveConfig({ enableLiveMint: false })), []);
});
