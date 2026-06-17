'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const USERS_FILE = path.join(config.dataDir, 'users.json');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function loadUsers() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return { authorized: [], sessions: {} };
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { authorized: [], sessions: {} };
  }
}

function saveUsers(data) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + config.apiSecret).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function register(email, password) {
  if (!email || !password) throw new Error('Email and password required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email format');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const users = loadUsers();
  if (users.authorized.some(u => u.email === email.toLowerCase())) {
    throw new Error('Email already registered');
  }

  const user = {
    id: 'u_' + Date.now(),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    isAdmin: users.authorized.length === 0, // First user is admin
  };

  users.authorized.push(user);
  saveUsers(users);
  return user;
}

function login(email, password) {
  const users = loadUsers();
  const user = users.authorized.find(u => u.email === email.toLowerCase());
  if (!user) throw new Error('Invalid email or password');

  const hash = hashPassword(password);
  if (user.passwordHash !== hash) throw new Error('Invalid email or password');

  const token = generateToken();
  users.sessions[token] = {
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  };
  saveUsers(users);
  return { token, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } };
}

function verifyToken(token) {
  if (!token) return null;
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

function logout(token) {
  const users = loadUsers();
  delete users.sessions[token];
  saveUsers(users);
}

function getUser(userId) {
  const users = loadUsers();
  return users.authorized.find(u => u.id === userId);
}

function authorizeEmail(email, isAdmin = false) {
  const users = loadUsers();
  const user = users.authorized.find(u => u.email === email.toLowerCase());
  if (!user) throw new Error('User not found');
  user.isAdmin = isAdmin;
  saveUsers(users);
  return user;
}

function getAuthorizedUsers() {
  const users = loadUsers();
  return users.authorized.map(u => ({
    id: u.id,
    email: u.email,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
  }));
}

module.exports = {
  register,
  login,
  verifyToken,
  logout,
  getUser,
  authorizeEmail,
  getAuthorizedUsers,
  hashPassword,
};
