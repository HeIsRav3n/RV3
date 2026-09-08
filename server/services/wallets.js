'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const dbConnection = require('../db');

const USE_DB = dbConnection.useDatabase();
const sql = dbConnection.sql;

const FILE = path.join(config.dataDir, 'wallets.json');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function loadFile() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function saveFile(wallets) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(wallets, null, 2));
}

async function ensureTable() {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS rv3_wallets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      addr TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'ETH',
      signer_type TEXT NOT NULL DEFAULT 'external',
      eth DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Existing custodial deployments created this table before signer_type was
  // introduced. Keep the schema migration additive so watch-only wallet
  // registration does not fail on those databases.
  await db`ALTER TABLE rv3_wallets ADD COLUMN IF NOT EXISTS signer_type TEXT NOT NULL DEFAULT 'external'`;
}

async function loadWallets() {
  if (USE_DB) {
    try {
      await ensureTable();
      const rows = await sql()`
        SELECT id, name, address, addr, chain, signer_type, eth, created_at
        FROM rv3_wallets ORDER BY created_at ASC
      `;
      return rows.map(r => ({
        id: r.id, name: r.name, address: r.address, addr: r.addr,
        chain: r.chain || 'ETH', signerType: r.signer_type || 'external',
        eth: parseFloat(r.eth) || 0, low: (parseFloat(r.eth) || 0) < 0.01,
        nonce: 0, createdAt: r.created_at,
      }));
    } catch (e) {
      console.error('wallets.loadWallets DB error:', e.message);
      return [];
    }
  }
  return loadFile();
}

async function saveWallet(entry) {
  if (USE_DB) {
    try {
      await ensureTable();
      await sql()`
        INSERT INTO rv3_wallets (id, name, address, addr, chain, signer_type, eth)
        VALUES (${entry.id}, ${entry.name}, ${entry.address}, ${entry.addr}, ${entry.chain || 'ETH'}, ${entry.signerType || 'external'}, ${entry.eth || 0})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          eth = EXCLUDED.eth,
          signer_type = EXCLUDED.signer_type
      `;
    } catch (e) {
      console.error('wallets.saveWallet DB error:', e.message);
    }
    return;
  }
  const list = loadFile();
  const idx = list.findIndex(w => w.id === entry.id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  saveFile(list);
}

async function deleteWallet(id) {
  if (USE_DB) {
    try {
      await ensureTable();
      await sql()`DELETE FROM rv3_wallets WHERE id = ${id}`;
    } catch (e) {
      console.error('wallets.deleteWallet DB error:', e.message);
    }
    return;
  }
  const list = loadFile().filter(w => w.id !== id);
  saveFile(list);
}

async function updateBalance(id, eth) {
  if (USE_DB) {
    try {
      await sql()`UPDATE rv3_wallets SET eth = ${eth} WHERE id = ${id}`;
    } catch { /* non-critical */ }
    return;
  }
  const list = loadFile();
  const w = list.find(x => x.id === id);
  if (w) { w.eth = eth; saveFile(list); }
}

module.exports = { loadWallets, saveWallet, deleteWallet, updateBalance };
