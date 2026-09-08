'use strict';

// Pre-signing is incompatible with external signing and can produce stale
// authorizations. Keep only safe cache-management no-ops until the provider
// supports an explicit, short-lived unsigned-transaction approval flow.
function getEntry() { return null; }
function isReady() { return false; }
function clearTask() {}
function clearEntry() {}
function selectPrewarmWallets() { return []; }
function taskWarmStatus() { return []; }
async function prewarmWallet() { return false; }
async function prewarmTask() { return { warmed: 0, wallets: [] }; }

module.exports = { prewarmTask, prewarmWallet, getEntry, isReady, clearTask, clearEntry, taskWarmStatus, selectPrewarmWallets };
