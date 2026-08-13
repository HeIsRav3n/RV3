'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function pickRpc(name, role, chain = 'ethereum') {
  const url = (process.env[name] || '').trim();
  if (!url || !url.startsWith('https://')) return null;
  return { id: `env_${name.toLowerCase()}`, name: name.replace(/_/g, ' '), role, url, chain, ms: null, active: true, fromEnv: true };
}

function pickBuilder(name) {
  const url = (process.env[name] || '').trim();
  if (!url || !url.startsWith('https://')) return null;
  return { id: name.toLowerCase(), name: name.replace(/ETH_BUILDER_/g, '').replace(/_/g, ' '), url };
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  apiSecret: (process.env.API_SECRET || '').trim(),
  openseaApiKey: (process.env.OPENSEA_API_KEY || '').trim(),
  etherscanApiKey: (process.env.ETHERSCAN_API_KEY || '').trim(),
  blurApiKey: (process.env.BLUR_API_KEY || '').trim(),
  flashbotsAuthKey: (process.env.FLASHBOTS_AUTH_PRIVATE_KEY || '').trim(),
  discordWebhook: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  telegramToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  telegramChatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  walletEncryptionKey: (process.env.WALLET_ENCRYPTION_KEY || '').trim(),
  enableLiveMint: process.env.ENABLE_LIVE_MINT === 'true',
  taskRateLimit: parseInt(process.env.TASK_RATE_LIMIT_PER_MIN || '10', 10),
  dataDir: process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data')),
  envRpcs: [
    pickRpc('ETH_RPC_PRIMARY', 'Primary', 'ethereum'),
    pickRpc('ETH_RPC_BLAST_1', 'Blast', 'ethereum'),
    pickRpc('ETH_RPC_BLAST_2', 'Blast', 'ethereum'),
    pickRpc('ETH_RPC_BLAST_3', 'Blast', 'ethereum'),
    pickRpc('ETH_RPC_PRIVATE', 'Private', 'ethereum'),
    pickRpc('BASE_RPC_PRIMARY', 'Primary', 'base'),
    pickRpc('BASE_RPC_BLAST_1', 'Blast', 'base'),
    pickRpc('POLYGON_RPC_PRIMARY', 'Primary', 'polygon'),
    pickRpc('BLAST_RPC_PRIMARY', 'Primary', 'blast'),
    pickRpc('ROBINHOOD_RPC_PRIMARY', 'Primary', 'robinhood'),
    pickRpc('ROBINHOOD_RPC_BLAST_1', 'Blast', 'robinhood'),
  ].filter(Boolean),
  // Built-in public endpoints that ship enabled by default so the chain is
  // usable and visible out of the box. Overridden if the user sets the matching
  // env RPC above (dedup by chain+role happens right after).
  defaultRpcs: [
    { id: 'default_robinhood', name: 'Robinhood Chain (public)', role: 'Primary', url: 'https://rpc.mainnet.chain.robinhood.com', chain: 'robinhood', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_base', name: 'Base (public)', role: 'Primary', url: 'https://mainnet.base.org', chain: 'base', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_blast', name: 'Blast (public)', role: 'Primary', url: 'https://rpc.blast.io', chain: 'blast', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_polygon', name: 'Polygon (public)', role: 'Primary', url: 'https://polygon-rpc.com', chain: 'polygon', ms: null, active: true, fromEnv: false, isDefault: true },
  ],
  builderRpcs: [
    pickBuilder('ETH_BUILDER_TITAN'),
    pickBuilder('ETH_BUILDER_BEAVER'),
    pickBuilder('ETH_BUILDER_RSYNC'),
    pickBuilder('ETH_BUILDER_FLASHBOTS'),
  ].filter(Boolean),
  workerTickMs: parseInt(process.env.WORKER_TICK_MS || '200', 10),
  copymintScanMs: parseInt(process.env.COPYMINT_SCAN_MS || '4000', 10),
};

// Merge default public RPCs, but only for chains the user hasn't already
// configured via env (env always wins over the shared public endpoint).
for (const d of config.defaultRpcs) {
  if (!config.envRpcs.some(r => r.chain === d.chain)) config.envRpcs.push(d);
}

config.hasWalletEncryption = config.walletEncryptionKey.length === 64 && /^[0-9a-fA-F]+$/.test(config.walletEncryptionKey);

module.exports = config;
