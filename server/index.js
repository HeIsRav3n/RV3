'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const auth = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const worker = require('./services/worker');

const app = express();
const root = path.join(__dirname, '..');

app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use('/api', auth, apiRoutes);

app.use(express.static(root, { index: 'index.html' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

worker.start();

app.listen(config.port, () => {
  console.log(`\n  RV3 Mint Bot`);
  console.log(`  ─────────────────────────────`);
  console.log(`  UI + API  →  http://localhost:${config.port}`);
  console.log(`  OpenSea   →  ${config.openseaApiKey ? 'configured' : '⚠ set OPENSEA_API_KEY in .env'}`);
  console.log(`  RPC env   →  ${config.envRpcs.length} endpoint(s)`);
  console.log(`  Live mint →  ${config.enableLiveMint ? 'ENABLED' : 'preflight only (set ENABLE_LIVE_MINT=true)'}`);
  console.log(`  Version   →  1.5.0 (mint · fund · sweep)`);
});
