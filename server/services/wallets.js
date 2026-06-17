'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const USE_DB = !!(process.env.DATABASE_URL || '').trim();

let neon;
if (USE_DB) {
  try { neon = require('@neondatabase/serverless').neon; } catch {}
}

function sql() {
  return neon(process.env.DATABASE_URL);
}

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
      encrypted_key TEXT,
      eth DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function loadWallets() {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      const rows = await sql()`SELECT * FROM rv3_wallets ORDER BY created_at ASC`;
      return rows.map(r => ({
        id: r.id, name: r.name, address: r.address, addr: r.addr,
        chain: r.chain || 'ETH', encryptedKey: r.encrypted_key || null,
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
  if (USE_DB && neon) {
    try {
      await ensureTable();
      await sql()`
        INSERT INTO rv3_wallets (id, name, address, addr, chain, encrypted_key, eth)
        VALUES (${entry.id}, ${entry.name}, ${entry.address}, ${entry.addr}, ${entry.chain || 'ETH'}, ${entry.encryptedKey || null}, ${entry.eth || 0})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          eth = EXCLUDED.eth,
          encrypted_key = COALESCE(EXCLUDED.encrypted_key, rv3_wallets.encrypted_key)
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
  if (USE_DB && neon) {
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
  if (USE_DB && neon) {
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
