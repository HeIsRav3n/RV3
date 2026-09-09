'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { assertProductionConfig } = require('./config/validateProductionConfig');

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

function resolveLiveMint(env = process.env) {
  // Vercel functions are ephemeral and cannot safely own a long-lived worker,
  // WalletConnect session, or transaction execution state. Keep the deployed
  // dashboard usable for discovery and preflight, but never allow it to become
  // a live execution host through an environment-variable accident.
  if (env.VERCEL) return false;
  return String(env.ENABLE_LIVE_MINT).toLowerCase() === 'true';
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiSecret: (process.env.API_SECRET || '').trim(),
  bootstrapSecret: (process.env.RV3_BOOTSTRAP_SECRET || '').trim(),
  bootstrapMode: String(process.env.RV3_BOOTSTRAP_MODE || 'disabled').toLowerCase() === 'enabled',
  openseaApiKey: (process.env.OPENSEA_API_KEY || '').trim(),
  openseaGraphqlEnabled: String(process.env.OPENSEA_GRAPHQL_ENABLED || 'false').toLowerCase() === 'true',
  eventProvider: (process.env.RV3_EVENT_PROVIDER || '').trim(),
  theGraphApiKey: (process.env.THE_GRAPH_API_KEY || '').trim(),
  theGraphEthereumSubgraph: (process.env.THE_GRAPH_ETHEREUM_SUBGRAPH_ID || '').trim(),
  theGraphRobinhoodSubgraph: (process.env.THE_GRAPH_ROBINHOOD_SUBGRAPH_ID || '').trim(),
  walletConnectProjectId: (process.env.WALLETCONNECT_PROJECT_ID || '').trim(),
  publicUrl: (process.env.RV3_PUBLIC_URL || '').trim().replace(/\/$/, ''),
  etherscanApiKey: (process.env.ETHERSCAN_API_KEY || '').trim(),
  blurApiKey: (process.env.BLUR_API_KEY || '').trim(),
  discordWebhook: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  telegramToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  telegramChatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  serverless: Boolean(process.env.VERCEL),
  enableLiveMint: resolveLiveMint(process.env),
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
    { id: 'default_ethereum', name: 'Ethereum (public)', role: 'Primary', url: 'https://ethereum-rpc.publicnode.com', chain: 'ethereum', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_base', name: 'Base (public)', role: 'Primary', url: 'https://mainnet.base.org', chain: 'base', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_base_publicnode', name: 'Base (public mirror)', role: 'Fallback', url: 'https://base-rpc.publicnode.com', chain: 'base', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_blast', name: 'Blast (public)', role: 'Primary', url: 'https://rpc.blast.io', chain: 'blast', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_polygon', name: 'Polygon (public)', role: 'Primary', url: 'https://polygon.drpc.org', chain: 'polygon', ms: null, active: true, fromEnv: false, isDefault: true },
    { id: 'default_polygon_publicnode', name: 'Polygon (public mirror)', role: 'Fallback', url: 'https://polygon.publicnode.com', chain: 'polygon', ms: null, active: true, fromEnv: false, isDefault: true },
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

assertProductionConfig(process.env, config);

module.exports = { ...config, resolveLiveMint };
