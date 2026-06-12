'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function pickRpc(name, role) {
  const url = (process.env[name] || '').trim();
  if (!url || !url.startsWith('https://')) return null;
  return { id: `env_${name.toLowerCase()}`, name: name.replace(/_/g, ' '), role, url, ms: null, active: true, fromEnv: true };
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
  dataDir: path.join(__dirname, '..', 'data'),
  envRpcs: [
    pickRpc('ETH_RPC_PRIMARY', 'Primary'),
    pickRpc('ETH_RPC_BLAST_1', 'Blast'),
    pickRpc('ETH_RPC_BLAST_2', 'Blast'),
    pickRpc('ETH_RPC_BLAST_3', 'Blast'),
    pickRpc('ETH_RPC_PRIVATE', 'Private'),
  ].filter(Boolean),
};

config.hasWalletEncryption = config.walletEncryptionKey.length === 64 && /^[0-9a-fA-F]+$/.test(config.walletEncryptionKey);

module.exports = config;
