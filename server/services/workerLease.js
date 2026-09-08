'use strict';

const crypto = require('crypto');
const { sql, useDatabase } = require('../db');

const HOLDER = process.env.RV3_WORKER_INSTANCE_ID || `rv3-${crypto.randomUUID()}`;

async function ensureTables() {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS rv3_worker_leases (
    name TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

// Claims a short database-backed lease. Calls from multiple workers serialize
// around the row lock, so only the current holder can process a live queue.
async function acquire(name = 'mint-worker', ttlMs = 15_000) {
  if (!useDatabase()) return { acquired: true, holder: HOLDER, durable: false };
  await ensureTables();
  const db = sql();
  return db.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
    const rows = await tx`SELECT holder, expires_at FROM rv3_worker_leases WHERE name = ${name} FOR UPDATE`;
    const current = rows[0];
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const expired = !current || new Date(current.expires_at).getTime() <= now;
    if (!expired && current.holder !== HOLDER) return { acquired: false, holder: current.holder, durable: true };
    await tx`INSERT INTO rv3_worker_leases (name, holder, expires_at, updated_at)
      VALUES (${name}, ${HOLDER}, ${expiresAt}, NOW())
      ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at, updated_at = NOW()`;
    return { acquired: true, holder: HOLDER, expiresAt, durable: true };
  });
}

module.exports = { acquire, HOLDER };
