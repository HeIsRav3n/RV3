'use strict';

// Restricted observer for public, free mints. It never signs, broadcasts, or
// copies calldata. A detected event can only create a normal RV3 preflight task.
const ALLOWED_CHAINS = new Set(['ethereum', 'robinhood']);
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const targets = [];
const feed = [];
let taskSink = null;

function addFeed(type, detail) {
  feed.unshift({ at: new Date().toISOString(), type, ...detail });
  feed.splice(100);
}

function validateTarget(input = {}) {
  const address = String(input.address || '').trim().toLowerCase();
  const chain = String(input.chain || 'ethereum').toLowerCase();
  if (!ADDRESS.test(address)) throw new Error('A valid public wallet address is required');
  if (!ALLOWED_CHAINS.has(chain)) throw new Error('Copy-mint monitoring supports Ethereum and Robinhood Chain only');
  return { address, chain, label: String(input.label || address.slice(0, 10)).slice(0, 60) };
}

async function addTarget(input) {
  const target = validateTarget(input);
  if (targets.some(t => t.address === target.address && t.chain === target.chain)) throw new Error('Target is already monitored');
  const entry = { id: `copy_${Date.now()}`, ...target, active: true, mode: 'free_public_preflight', createdAt: new Date().toISOString() };
  targets.unshift(entry);
  addFeed('target_added', { targetId: entry.id, chain: entry.chain, label: entry.label });
  return entry;
}

async function removeTarget(id) {
  const index = targets.findIndex(t => t.id === id);
  if (index < 0) throw new Error('Target not found');
  const [removed] = targets.splice(index, 1);
  addFeed('target_removed', { targetId: removed.id, chain: removed.chain });
  return true;
}

async function toggleTarget(id, active) {
  const target = targets.find(t => t.id === id);
  if (!target) throw new Error('Target not found');
  target.active = active !== false;
  addFeed('target_toggled', { targetId: target.id, active: target.active });
  return target;
}

function setTaskSink(fn) { taskSink = fn; }

// Adapter boundary for an approved event-stream provider. Callers may submit
// only verified public event metadata; any non-free/non-public event is ignored.
async function observePublicMint(event = {}) {
  const chain = String(event.chain || '').toLowerCase();
  const priceWei = String(event.priceWei ?? '');
  const contractAddress = String(event.contractAddress || '').toLowerCase();
  const slug = String(event.openseaSlug || '').trim();
  if (!ALLOWED_CHAINS.has(chain) || event.isPublic !== true || priceWei !== '0' || !ADDRESS.test(contractAddress) || !slug) {
    addFeed('ignored', { reason: 'Event did not meet free/public/chain validation' });
    return { queued: false, reason: 'Only verified public free mints on Ethereum or Robinhood Chain are eligible' };
  }
  const matching = targets.filter(t => t.active && t.chain === chain);
  if (!matching.length) return { queued: false, reason: 'No active target for this chain' };
  if (!taskSink) return { queued: false, reason: 'Worker task sink is unavailable' };
  const task = await taskSink({
    drop: String(event.drop || slug).slice(0, 120), openseaSlug: slug, contractAddress,
    chainSlug: chain, qty: 1, wallets: Math.min(matching.length, 50),
    copyMint: { source: 'public_event', freeOnly: true, targetIds: matching.map(t => t.id) },
  });
  addFeed('preflight_queued', { taskId: task.id, chain, contractAddress, targetCount: matching.length });
  return { queued: true, task };
}

async function start() { addFeed('worker_ready', { mode: 'free_public_preflight_only' }); }
async function scanOnce() { return { scanned: 0, queued: 0, mode: 'awaiting_approved_event_stream' }; }
async function startWatching() { return getStatus(); }
function stopWatching() {}
function listTargets() { return targets; }
function getFeed() { return feed; }
function getStatus() { return { active: true, mode: 'free_public_preflight_only', chains: [...ALLOWED_CHAINS], targetCount: targets.filter(t => t.active).length, signerRequired: true }; }
async function loadTargets() { return targets; }
async function saveTarget() { throw new Error('Use addTarget'); }
async function deleteTarget(id) { return removeTarget(id); }

module.exports = { start, scanOnce, startWatching, stopWatching, addTarget, removeTarget, toggleTarget, listTargets, getFeed, getStatus, loadTargets, saveTarget, deleteTarget, setTaskSink, observePublicMint };
