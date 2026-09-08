#!/usr/bin/env node

// Imports only provider and operational settings from a legacy RV3 .env file.
// Signing material and live execution controls are deliberately never imported.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const IMPORTABLE_KEYS = new Set([
  'PORT', 'API_SECRET', 'OPENSEA_API_KEY', 'ETHERSCAN_API_KEY', 'BLUR_API_KEY',
  'ETH_RPC_PRIMARY', 'ETH_RPC_BLAST_1', 'ETH_RPC_BLAST_2', 'ETH_RPC_BLAST_3',
  'ETH_RPC_PRIVATE', 'DISCORD_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID', 'TASK_RATE_LIMIT_PER_MIN', 'WORKER_TICK_MS',
  'COPYMINT_SCAN_MS', 'BASE_RPC_PRIMARY', 'BASE_RPC_BLAST_1',
  'POLYGON_RPC_PRIMARY', 'BLAST_RPC_PRIMARY', 'ROBINHOOD_RPC_PRIMARY',
  'ROBINHOOD_RPC_BLAST_1'
]);

const BLOCKED_KEYS = new Set([
  'DATABASE_URL', 'ENABLE_LIVE_MINT', 'WALLET_ENCRYPTION_KEY',
  'FLASHBOTS_AUTH_PRIVATE_KEY'
]);

function parse(file) {
  return dotenv.parse(fs.readFileSync(file));
}

function merge(existing, legacy) {
  const imported = [];
  const skipped = [];
  for (const [key, value] of Object.entries(legacy)) {
    if (BLOCKED_KEYS.has(key)) {
      skipped.push(key);
      continue;
    }
    if (IMPORTABLE_KEYS.has(key) && value.trim()) {
      existing[key] = value;
      imported.push(key);
    }
  }
  // Existing database configuration remains authoritative and live execution
  // must require the current release runbook, not an old environment file.
  existing.ENABLE_LIVE_MINT = 'false';
  return { imported, skipped };
}

function serialize(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function main() {
  const [legacyFile, destinationFile] = process.argv.slice(2);
  if (!legacyFile || !destinationFile) {
    throw new Error('Usage: node scripts/import-legacy-env.js <legacy.env> <destination.env>');
  }
  const legacy = parse(path.resolve(legacyFile));
  const destination = path.resolve(destinationFile);
  const existing = fs.existsSync(destination) ? parse(destination) : {};
  const { imported, skipped } = merge(existing, legacy);
  fs.writeFileSync(destination, serialize(existing), { mode: 0o600 });
  console.log(`Imported ${imported.length} compatible setting(s): ${imported.join(', ') || 'none'}`);
  console.log(`Not imported: ${skipped.join(', ') || 'none'}`);
  console.log('Live minting remains disabled. No signing material was imported.');
}

if (require.main === module) main();

module.exports = { IMPORTABLE_KEYS, BLOCKED_KEYS, merge };
