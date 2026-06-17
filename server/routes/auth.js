'use strict';

const express = require('express');
const authService = require('../services/auth');

const router = express.Router();

// Middleware to check if user is authenticated
function authRequired(req, res, next) {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const session = authService.verifyToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
  req.session = session;
  req.token = token;
  next();
}

// Middleware to check if user is admin
function adminRequired(req, res, next) {
  if (!req.session?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }
  next();
}

// Login endpoint
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const result = authService.login(email, password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// Register endpoint (first user becomes admin, others need authorization)
router.post('/register', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = authService.register(email, password);
    // Auto-login after registration
    const result = authService.login(email, password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Verify token
router.post('/verify', (req, res) => {
  try {
    const token = req.headers['x-auth-token'] || req.body?.token;
    const session = authService.verifyToken(token);
    if (!session) return res.status(401).json({ error: 'Invalid or expired token' });
    const user = authService.getUser(session.userId);
    res.json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin }, session });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Logout
router.post('/logout', authRequired, (req, res) => {
  authService.logout(req.token);
  res.json({ ok: true });
});

// Get authorized users (admin only)
router.get('/users', authRequired, adminRequired, (req, res) => {
  try {
    const users = authService.getAuthorizedUsers();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Authorize user email (admin only)
router.post('/authorize-user', authRequired, adminRequired, (req, res) => {
  try {
    const { email, isAdmin } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = authService.authorizeEmail(email, !!isAdmin);
    res.json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
module.exports.authRequired = authRequired;
module.exports.adminRequired = adminRequired;
