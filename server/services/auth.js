'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const USE_DB = !!(process.env.DATABASE_URL || '').trim();
const SESSION_MS = 8 * 60 * 60 * 1000;
const USERS_FILE = path.join(config.dataDir, 'users.json');
let neon;
if (USE_DB) {
  try { neon = require('@neondatabase/serverless').neon; } catch {}
}

function sql() {
  if (!neon) throw new Error('Database driver unavailable');
  return neon(process.env.DATABASE_URL);
}

let authTablesReady = false;
async function ensureAuthTables() {
  if (!USE_DB || authTablesReady) return;
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await db`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT, is_admin BOOLEAN,
    created_at BIGINT, expires_at BIGINT NOT NULL
  )`;
  authTablesReady = true;
}

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}

function loadUsers() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return { authorized: [], sessions: {} };
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return { authorized: data.authorized || [], sessions: data.sessions || {} };
  } catch {
    return { authorized: [], sessions: {} };
  }
}

function saveUsers(data) {
  ensureDir();
  const temp = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, USERS_FILE);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 14) {
    throw new Error('Password must be at least 14 characters');
  }
  if (password.length > 256) throw new Error('Password is too long');
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string' || password.length > 256) return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'));
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  if (!config.apiSecret) return false;
  const legacy = crypto.createHash('sha256').update(password + config.apiSecret).digest();
  const expected = Buffer.from(stored, 'hex');
  return legacy.length === expected.length && crypto.timingSafeEqual(legacy, expected);
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readSessionToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const prefix = `${config.sessionCookieName}=`;
  const match = cookies.map(v => v.trim()).find(v => v.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

async function userCount() {
  if (USE_DB) {
    await ensureAuthTables();
    const rows = await sql()`SELECT COUNT(*)::int AS count FROM users`;
    return Number(rows[0]?.count || 0);
  }
  return loadUsers().authorized.length;
}

async function getAuthStatus() {
  const count = await userCount();
  return { needsBootstrap: count === 0, adminConfigured: !!config.adminEmail };
}

async function register(email, password) {
  const lc = normalizeEmail(email);
  if (!config.adminEmail) throw new Error('ADMIN_EMAIL must be configured by the operator');
  if (lc !== config.adminEmail) throw new Error('This email is not authorized for initial setup');
  if (await userCount()) throw new Error('Initial setup is closed');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lc)) throw new Error('Invalid email format');
  const hash = await hashPassword(password);
  const id = `u_${crypto.randomUUID()}`;

  if (USE_DB) {
    await sql()`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${lc}, ${hash}, TRUE)`;
  } else {
    const users = loadUsers();
    users.authorized.push({ id, email: lc, passwordHash: hash, createdAt: new Date().toISOString(), isAdmin: true });
    saveUsers(users);
  }
  return { id, email: lc, isAdmin: true };
}

async function login(email, password) {
  const lc = normalizeEmail(email);
  let user;
  let storedHash;
  if (USE_DB) {
    await ensureAuthTables();
    const rows = await sql()`SELECT id, email, password_hash, is_admin FROM users WHERE email = ${lc}`;
    if (rows.length) {
      user = { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin };
      storedHash = rows[0].password_hash;
    }
  } else {
    const found = loadUsers().authorized.find(u => u.email === lc);
    if (found) {
      user = found;
      storedHash = found.passwordHash;
    }
  }
  if (!user || !(await verifyPassword(password, storedHash))) throw new Error('Invalid email or password');

  if (user.email === config.adminEmail && !user.isAdmin) {
    user.isAdmin = true;
    if (USE_DB) await sql()`UPDATE users SET is_admin = TRUE WHERE id = ${user.id}`;
    else {
      const data = loadUsers();
      const record = data.authorized.find(u => u.id === user.id);
      if (record) { record.isAdmin = true; saveUsers(data); }
    }
  }

  if (!storedHash.startsWith('scrypt$')) {
    const upgraded = await hashPassword(password);
    if (USE_DB) await sql()`UPDATE users SET password_hash = ${upgraded} WHERE id = ${user.id}`;
    else {
      const data = loadUsers();
      const record = data.authorized.find(u => u.id === user.id);
      if (record) { record.passwordHash = upgraded; saveUsers(data); }
    }
  }

  const token = generateToken();
  const hash = tokenHash(token);
  const now = Date.now();
  const exp = now + SESSION_MS;
  if (USE_DB) {
    await sql()`INSERT INTO sessions (token, user_id, email, is_admin, created_at, expires_at)
      VALUES (${hash}, ${user.id}, ${user.email}, ${!!user.isAdmin}, ${now}, ${exp})`;
    sql()`DELETE FROM sessions WHERE expires_at < ${now}`.catch(() => {});
  } else {
    const data = loadUsers();
    data.sessions[hash] = { userId: user.id, email: user.email, isAdmin: !!user.isAdmin, createdAt: now, expiresAt: exp };
    for (const [key, session] of Object.entries(data.sessions)) if (session.expiresAt < now) delete data.sessions[key];
    saveUsers(data);
  }
  return { token, user: { id: user.id, email: user.email, isAdmin: !!user.isAdmin } };
}

async function verifyToken(token) {
  if (!token) return null;
  const hash = tokenHash(token);
  if (USE_DB) {
    await ensureAuthTables();
    const rows = await sql()`SELECT user_id, email, is_admin FROM sessions WHERE token = ${hash} AND expires_at > ${Date.now()}`;
    if (!rows.length) return null;
    return { userId: rows[0].user_id, email: rows[0].email, isAdmin: rows[0].is_admin };
  }
  const data = loadUsers();
  const session = data.sessions[hash];
  if (!session) return null;
  if (Date.now() > session.expiresAt) { delete data.sessions[hash]; saveUsers(data); return null; }
  return session;
}

async function logout(token) {
  if (!token) return;
  const hash = tokenHash(token);
  if (USE_DB) await sql()`DELETE FROM sessions WHERE token = ${hash}`;
  else { const data = loadUsers(); delete data.sessions[hash]; saveUsers(data); }
}

async function getUser(userId) {
  if (USE_DB) {
    const rows = await sql()`SELECT id, email, is_admin, created_at FROM users WHERE id = ${userId}`;
    if (!rows.length) return null;
    return { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin, createdAt: rows[0].created_at };
  }
  return loadUsers().authorized.find(u => u.id === userId) || null;
}

async function authorizeEmail(email, isAdmin = false) {
  const lc = normalizeEmail(email);
  if (lc === config.adminEmail && !isAdmin) throw new Error('The primary administrator cannot be demoted');
  if (USE_DB) {
    const rows = await sql()`UPDATE users SET is_admin = ${isAdmin} WHERE email = ${lc} RETURNING id, email, is_admin`;
    if (!rows.length) throw new Error('User not found');
    return { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin };
  }
  const data = loadUsers();
  const user = data.authorized.find(u => u.email === lc);
  if (!user) throw new Error('User not found');
  user.isAdmin = isAdmin;
  saveUsers(data);
  return user;
}

async function getAuthorizedUsers() {
  if (USE_DB) {
    const rows = await sql()`SELECT id, email, is_admin, created_at FROM users ORDER BY created_at ASC`;
    return rows.map(u => ({ id: u.id, email: u.email, isAdmin: u.is_admin, createdAt: u.created_at }));
  }
  return loadUsers().authorized.map(u => ({ id: u.id, email: u.email, isAdmin: u.isAdmin, createdAt: u.createdAt }));
}

module.exports = {
  register, login, verifyToken, logout, getUser, authorizeEmail, getAuthorizedUsers,
  getAuthStatus, readSessionToken, hashPassword, verifyPassword,
};
