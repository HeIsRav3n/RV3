'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const worker = require('./services/worker');
const { authRequired, adminRequired } = require('./routes/auth');
const auth = require('./middleware/auth');

const app = express();
const root = path.join(__dirname, '..');
app.disable('x-powered-by');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // The legacy UI includes inline styles/scripts, so a nonce-based policy is a
  // follow-up refactor. This still prevents plugins and unexpected origins.
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  if (config.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const isHtml = req.path === '/' || req.path.endsWith('.html') || !path.extname(req.path);
  if (isHtml) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

app.use(cors({ origin: false }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, version: require('../package.json').version, time: new Date().toISOString() });
});

app.use('/auth', authRoutes);
// RV3 is a single-operator system. Every operational API is administrator-only.
app.use('/api', authRequired, auth, adminRequired, apiRoutes);

app.use(express.static(root, { index: 'index.html' }));
app.use((req, res) => { res.sendFile(path.join(root, 'index.html')); });
app.use((err, req, res, next) => {
  console.error('RV3 request failed:', err?.message || 'unknown error');
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// A Vercel function is an on-demand request handler, not a durable worker.
// The UI, discovery, and preflight routes remain available there; background
// scheduling and any future live execution require a persistent Node host.
if (!config.serverless) worker.start();

if (require.main === module) {
  app.listen(config.port, () => {
    const v = require('../package.json').version;
    console.log(`\n  RV3 Mint Bot  v${v}`);
    console.log(`  ${'─'.repeat(36)}`);
    console.log(`  UI        →  http://localhost:${config.port}`);
    console.log(`  OpenSea   →  ${config.openseaApiKey ? 'configured' : 'set OPENSEA_API_KEY'}`);
    console.log(`  RPC       →  ${config.envRpcs.length} endpoint(s) configured`);
    console.log(`  Live mint →  ${config.enableLiveMint ? 'ENABLED' : 'preflight only'}`);
    console.log(`  ${'─'.repeat(36)}\n`);
  });
}

module.exports = app;
