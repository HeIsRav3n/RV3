'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const worker = require('./services/worker');
const { authRequired } = require('./routes/auth');
const auth = require('./middleware/auth');

const app = express();
const root = path.join(__dirname, '..');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors({ origin: false }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/api', authRequired, auth, apiRoutes);

app.use(express.static(root, { index: 'index.html' }));
app.use((req, res) => { res.sendFile(path.join(root, 'index.html')); });

worker.start();

if (require.main === module) {
  app.listen(config.port, () => {
    const v = '2.0.0';
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
