'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const worker = require('./services/worker');
const { authRequired } = require('./routes/auth');

const app = express();
const root = path.join(__dirname, '..');
app.disable('x-powered-by');
if (config.isProduction) app.set('trust proxy', 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Cache-Control', req.path.startsWith('/api') || req.path.startsWith('/auth') ? 'no-store' : 'no-cache');
  next();
});

app.use(cors({ origin: false }));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/api', authRequired, apiRoutes);

app.use(express.static(root, { index: 'index.html' }));
app.use((req, res) => { res.sendFile(path.join(root, 'index.html')); });

worker.start();

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
