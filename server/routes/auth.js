'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/auth');
const config = require('../config');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many registration attempts. Try again later.' } });

function cookieToken(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)rv3_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function setSessionCookie(res, token) {
  res.cookie('rv3_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function authRequired(req, res, next) {
  const token = cookieToken(req);
  const session = await authService.verifyToken(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  req.session = session;
  req.token = token;
  next();
}

function adminRequired(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Forbidden — admin access required' });
  next();
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await authService.login(email, password);
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    if (config.env === 'production') {
      const supplied = String(req.headers['x-rv3-bootstrap'] || '');
      if (!config.bootstrapMode || !config.bootstrapSecret || supplied !== config.bootstrapSecret) {
        return res.status(403).json({ error: 'Production registration is disabled. Use the one-time bootstrap procedure.' });
      }
    }
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    await authService.register(email, password, { bootstrapOnly: config.env === 'production' });
    const result = await authService.login(email, password);
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Registration failed' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const token = cookieToken(req);
    const session = await authService.verifyToken(token);
    if (!session) return res.status(401).json({ error: 'Invalid or expired token' });
    const user = await authService.getUser(session.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin }, session });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/logout', authRequired, async (req, res) => {
  await authService.logout(req.token);
  res.clearCookie('rv3_session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

router.get('/users', authRequired, adminRequired, async (req, res) => {
  try {
    const users = await authService.getAuthorizedUsers();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/authorize-user', authRequired, adminRequired, async (req, res) => {
  try {
    const { email, isAdmin } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await authService.authorizeEmail(email, !!isAdmin);
    res.json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
module.exports.authRequired = authRequired;
module.exports.adminRequired = adminRequired;
