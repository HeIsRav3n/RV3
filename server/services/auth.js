'use strict';

const crypto = require('crypto');
const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const dbConnection = require('../db');

// ── Storage backend: Neon (Vercel) or file (local) ──────────────────────────

const USE_DB = dbConnection.useDatabase();
const sql = dbConnection.sql;

// Auto-provision the auth schema so a fresh Neon/Postgres DB works without
// running manual SQL. Idempotent — runs once per process, then no-ops.
let authTablesReady = false;
async function ensureAuthTables() {
  if (!USE_DB || authTablesReady) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT,
      is_admin BOOLEAN,
      created_at BIGINT,
      expires_at BIGINT NOT NULL
    )
  `;
  authTablesReady = true;
}

// ── File-based helpers (local dev) ──────────────────────────────────────────

const USERS_FILE = path.join(config.dataDir, 'users.json');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function loadUsers() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return { authorized: [], sessions: {} };
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return { authorized: [], sessions: {} }; }
}

function saveUsers(data) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function legacyHashPassword(password) {
  return crypto.createHash('sha256').update(password + config.apiSecret).digest('hex');
}

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function verifyPassword(password, storedHash) {
  if (String(storedHash).startsWith('$argon2')) return argon2.verify(storedHash, password);
  const expected = legacyHashPassword(password);
  const received = String(storedHash);
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Auth operations ──────────────────────────────────────────────────────────

async function register(email, password, { bootstrapOnly = false } = {}) {
  if (!email || !password) throw new Error('Email and password required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email format');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const lc = email.toLowerCase();
  const hash = await hashPassword(password);
  const id = 'u_' + Date.now();

  if (USE_DB) {
    await ensureAuthTables();
    const db = sql();
    const existing = await db`SELECT id FROM users WHERE email = ${lc}`;
    if (existing.length) throw new Error('Email already registered');
    const isFirst = String((await db`SELECT COUNT(*) AS c FROM users`)[0].c) === '0';
    if (bootstrapOnly && !isFirst) throw new Error('The production bootstrap account already exists');
    await db`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${lc}, ${hash}, ${isFirst})`;
    return { id, email: lc, isAdmin: isFirst };
  }

  const users = loadUsers();
  if (users.authorized.some(u => u.email === lc)) throw new Error('Email already registered');
  const isFirst = users.authorized.length === 0;
  if (bootstrapOnly && !isFirst) throw new Error('The production bootstrap account already exists');
  const user = { id, email: lc, passwordHash: hash, createdAt: new Date().toISOString(), isAdmin: isFirst };
  users.authorized.push(user);
  saveUsers(users);
  return user;
}

async function login(email, password) {
  const lc = email.toLowerCase();
  if (USE_DB) {
    await ensureAuthTables();
    const db = sql();
    const rows = await db`SELECT id, email, is_admin, password_hash FROM users WHERE email = ${lc}`;
    if (!rows.length) throw new Error('Invalid email or password');
    const user = rows[0];
    if (!await verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password');
    if (!String(user.password_hash).startsWith('$argon2')) {
      await db`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${user.id}`;
    }
    const token = generateToken();
    const tokenHash = hashSessionToken(token);
    const now = Date.now();
    const exp = now + 7 * 24 * 60 * 60 * 1000;
    await db`INSERT INTO sessions (token, user_id, email, is_admin, created_at, expires_at)
             VALUES (${tokenHash}, ${user.id}, ${user.email}, ${user.is_admin}, ${now}, ${exp})`;
    // Purge expired sessions lazily
    db`DELETE FROM sessions WHERE expires_at < ${now}`.catch(() => {});
    return { token, user: { id: user.id, email: user.email, isAdmin: user.is_admin } };
  }

  const users = loadUsers();
  const user = users.authorized.find(u => u.email === lc);
  if (!user || !await verifyPassword(password, user.passwordHash)) throw new Error('Invalid email or password');
  if (!String(user.passwordHash).startsWith('$argon2')) user.passwordHash = await hashPassword(password);
  const token = generateToken();
  users.sessions[hashSessionToken(token)] = {
    userId: user.id, email: user.email, isAdmin: user.isAdmin,
    createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  saveUsers(users);
  return { token, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } };
}

async function verifyToken(token) {
  if (!token) return null;

  if (USE_DB) {
    await ensureAuthTables();
    const db = sql();
    const rows = await db`SELECT * FROM sessions WHERE token = ${hashSessionToken(token)} AND expires_at > ${Date.now()}`;
    if (!rows.length) return null;
    const s = rows[0];
    return { userId: s.user_id, email: s.email, isAdmin: s.is_admin };
  }

  const users = loadUsers();
  const tokenHash = hashSessionToken(token);
  const session = users.sessions[tokenHash];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete users.sessions[tokenHash];
    saveUsers(users);
    return null;
  }
  return session;
}

async function logout(token) {
  if (USE_DB) {
    const db = sql();
    await db`DELETE FROM sessions WHERE token = ${hashSessionToken(token)}`;
    return;
  }
  const users = loadUsers();
  delete users.sessions[hashSessionToken(token)];
  saveUsers(users);
}

async function getUser(userId) {
  if (USE_DB) {
    const db = sql();
    const rows = await db`SELECT id, email, is_admin, created_at FROM users WHERE id = ${userId}`;
    if (!rows.length) return null;
    const u = rows[0];
    return { id: u.id, email: u.email, isAdmin: u.is_admin, createdAt: u.created_at };
  }
  const users = loadUsers();
  return users.authorized.find(u => u.id === userId) || null;
}

async function authorizeEmail(email, isAdmin = false) {
  const lc = email.toLowerCase();
  if (USE_DB) {
    const db = sql();
    const rows = await db`UPDATE users SET is_admin = ${isAdmin} WHERE email = ${lc} RETURNING id, email, is_admin`;
    if (!rows.length) throw new Error('User not found');
    const u = rows[0];
    return { id: u.id, email: u.email, isAdmin: u.is_admin };
  }
  const users = loadUsers();
  const user = users.authorized.find(u => u.email === lc);
  if (!user) throw new Error('User not found');
  user.isAdmin = isAdmin;
  saveUsers(users);
  return user;
}

async function getAuthorizedUsers() {
  if (USE_DB) {
    const db = sql();
    const rows = await db`SELECT id, email, is_admin, created_at FROM users ORDER BY created_at ASC`;
    return rows.map(u => ({ id: u.id, email: u.email, isAdmin: u.is_admin, createdAt: u.created_at }));
  }
  const users = loadUsers();
  return users.authorized.map(u => ({ id: u.id, email: u.email, isAdmin: u.isAdmin, createdAt: u.createdAt }));
}

module.exports = { register, login, verifyToken, logout, getUser, authorizeEmail, getAuthorizedUsers, hashPassword, verifyPassword, hashSessionToken };
