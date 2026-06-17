'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// ── Storage backend: Neon (Vercel) or file (local) ──────────────────────────

const USE_DB = !!(process.env.DATABASE_URL || '').trim();

let neon;
if (USE_DB) {
  try { neon = require('@neondatabase/serverless').neon; } catch {}
}

function sql() {
  if (!neon) throw new Error('Neon driver not loaded');
  return neon(process.env.DATABASE_URL);
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

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + config.apiSecret).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Auth operations ──────────────────────────────────────────────────────────

async function register(email, password) {
  if (!email || !password) throw new Error('Email and password required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email format');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const lc = email.toLowerCase();
  const hash = hashPassword(password);
  const id = 'u_' + Date.now();

  if (USE_DB) {
    const db = sql();
    const existing = await db`SELECT id FROM users WHERE email = ${lc}`;
    if (existing.length) throw new Error('Email already registered');
    const isFirst = (await db`SELECT COUNT(*) AS c FROM users`)[0].c === '0';
    await db`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${lc}, ${hash}, ${isFirst})`;
    return { id, email: lc, isAdmin: isFirst };
  }

  const users = loadUsers();
  if (users.authorized.some(u => u.email === lc)) throw new Error('Email already registered');
  const isFirst = users.authorized.length === 0;
  const user = { id, email: lc, passwordHash: hash, createdAt: new Date().toISOString(), isAdmin: isFirst };
  users.authorized.push(user);
  saveUsers(users);
  return user;
}

async function login(email, password) {
  const lc = email.toLowerCase();
  const hash = hashPassword(password);

  if (USE_DB) {
    const db = sql();
    const rows = await db`SELECT id, email, is_admin FROM users WHERE email = ${lc} AND password_hash = ${hash}`;
    if (!rows.length) throw new Error('Invalid email or password');
    const user = rows[0];
    const token = generateToken();
    const now = Date.now();
    const exp = now + 7 * 24 * 60 * 60 * 1000;
    await db`INSERT INTO sessions (token, user_id, email, is_admin, created_at, expires_at)
             VALUES (${token}, ${user.id}, ${user.email}, ${user.is_admin}, ${now}, ${exp})`;
    // Purge expired sessions lazily
    db`DELETE FROM sessions WHERE expires_at < ${now}`.catch(() => {});
    return { token, user: { id: user.id, email: user.email, isAdmin: user.is_admin } };
  }

  const users = loadUsers();
  const user = users.authorized.find(u => u.email === lc);
  if (!user || user.passwordHash !== hash) throw new Error('Invalid email or password');
  const token = generateToken();
  users.sessions[token] = {
    userId: user.id, email: user.email, isAdmin: user.isAdmin,
    createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  saveUsers(users);
  return { token, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } };
}

async function verifyToken(token) {
  if (!token) return null;

  if (USE_DB) {
    const db = sql();
    const rows = await db`SELECT * FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()}`;
    if (!rows.length) return null;
    const s = rows[0];
    return { userId: s.user_id, email: s.email, isAdmin: s.is_admin };
  }

  const users = loadUsers();
  const session = users.sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete users.sessions[token];
    saveUsers(users);
    return null;
  }
  return session;
}

async function logout(token) {
  if (USE_DB) {
    const db = sql();
    await db`DELETE FROM sessions WHERE token = ${token}`;
    return;
  }
  const users = loadUsers();
  delete users.sessions[token];
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

module.exports = { register, login, verifyToken, logout, getUser, authorizeEmail, getAuthorizedUsers, hashPassword };
