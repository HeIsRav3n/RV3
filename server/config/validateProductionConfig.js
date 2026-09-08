'use strict';

const PLACEHOLDER = /^(change_me|your[_-]|example|replace[_-]|todo|null|undefined)$/i;
const SUPPORTED_EXTERNAL_SIGNERS = new Set(['walletconnect']);

const isPlaceholder = (value) => PLACEHOLDER.test(String(value || '').trim());

function validateProductionConfig(env, config) {
  if (config.env !== 'production' || !config.enableLiveMint) return [];

  const errors = [];
  if (isPlaceholder(config.apiSecret) || config.apiSecret.length < 32) {
    errors.push('API_SECRET must be a non-placeholder secret of at least 32 characters when live execution is enabled.');
  }
  if (!env.DATABASE_URL || isPlaceholder(env.DATABASE_URL)) {
    errors.push('DATABASE_URL is required for durable persistence when live execution is enabled.');
  }
  if (env.VERCEL || config.dataDir === '/tmp') {
    errors.push('Live execution cannot use ephemeral /tmp persistence or a serverless Vercel worker.');
  }
  if (!config.envRpcs.some((rpc) => rpc.fromEnv)) {
    errors.push('At least one HTTPS RPC endpoint supplied by environment configuration is required when live execution is enabled.');
  }
  for (const name of ['RV3_EXTERNAL_SIGNER_PROVIDER', 'RV3_ALLOWED_CHAINS', 'RV3_ALLOWED_CONTRACTS', 'RV3_MAX_TX_VALUE_WEI', 'RV3_DAILY_SPEND_WEI']) {
    if (!env[name] || isPlaceholder(env[name])) errors.push(`${name} is required when live execution is enabled.`);
  }
  const provider = String(env.RV3_EXTERNAL_SIGNER_PROVIDER || '').trim().toLowerCase();
  if (provider && !SUPPORTED_EXTERNAL_SIGNERS.has(provider)) {
    errors.push('RV3_EXTERNAL_SIGNER_PROVIDER must name an RV3-supported non-custodial signer.');
  }
  if (provider === 'walletconnect') {
    if (!env.WALLETCONNECT_PROJECT_ID || isPlaceholder(env.WALLETCONNECT_PROJECT_ID)) {
      errors.push('WALLETCONNECT_PROJECT_ID is required when WalletConnect is selected for live execution.');
    }
    if (!/^https:\/\//i.test(String(env.RV3_PUBLIC_URL || ''))) {
      errors.push('RV3_PUBLIC_URL must be the final HTTPS RV3 origin when WalletConnect is selected for live execution.');
    }
  }
  return errors;
}

function assertProductionConfig(env, config) {
  const errors = validateProductionConfig(env, config);
  if (errors.length) throw new Error(`Unsafe live-execution configuration:\n- ${errors.join('\n- ')}`);
}

module.exports = { validateProductionConfig, assertProductionConfig, SUPPORTED_EXTERNAL_SIGNERS };
