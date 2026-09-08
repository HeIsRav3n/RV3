'use strict';

// Provider-neutral PostgreSQL boundary. Any SSL-capable PostgreSQL service
// (Supabase, Neon, Railway, RDS, self-hosted) can use DATABASE_URL.
let client = null;

function useDatabase() { return !!String(process.env.DATABASE_URL || '').trim(); }

function sql() {
  if (!useDatabase()) throw new Error('DATABASE_URL is not configured');
  if (!client) {
    const postgres = require('postgres');
    client = postgres(process.env.DATABASE_URL, {
      ssl: 'require', max: 5, idle_timeout: 20, connect_timeout: 10,
      prepare: false,
    });
  }
  return client;
}

async function close() {
  if (client) await client.end({ timeout: 5 });
  client = null;
}

module.exports = { useDatabase, sql, close };
