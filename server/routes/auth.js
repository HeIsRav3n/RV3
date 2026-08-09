'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const authService = require('../services/auth');

const router = express.Router();

async function authRequired(req, res, next) {
  const token = authService.readSessionToken(req);
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

function setSessionCookie(res, token) {
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${config.sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`);
}

function clearSessionCookie(res) {
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

router.get('/status', async (req, res) => {
  res.json(await authService.getAuthStatus());
});

router.post('/login', authLimiter, async (req, res) => {
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

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    await authService.register(email, password);
    const result = await authService.login(email, password);
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Registration failed' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const token = authService.readSessionToken(req);
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
  clearSessionCookie(res);
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
