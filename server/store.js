'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.dataDir, 'state.json');

const defaultState = () => ({
  wallets: [],
  drops: [],
  tasks: [],
  fundOps: [],
  sweepOps: [],
  history: [],
  logs: [],
  deployments: [],
});

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return defaultState();
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...defaultState(), ...data };
  } catch {
    return defaultState();
  }
}

function save(state) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

function appendLog(state, level, message) {
  const entry = { time: new Date().toISOString(), level, message };
  state.logs = [entry, ...(state.logs || [])].slice(0, 500);
  return entry;
}

module.exports = { load, save, appendLog, defaultState };
