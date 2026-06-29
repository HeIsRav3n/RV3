'use strict';

const rpc = require('./rpc');
const taskStore = require('./taskStore');

/**
 * Check eth_getTransactionReceipt for a single txHash.
 * Returns { status, blockNumber, gasUsed } if confirmed, null if still pending.
 */
async function checkReceipt(txHash, urls) {
  for (const url of urls) {
    try {
      const [result] = await rpc.batchCall(url, [
        { method: 'eth_getTransactionReceipt', params: [txHash] },
      ], 5000);
      if (result) {
        return {
          status: parseInt(result.status, 16) === 1 ? 'confirmed' : 'reverted',
          blockNumber: parseInt(result.blockNumber, 16),
          gasUsed: result.gasUsed ? parseInt(result.gasUsed, 16) : null,
        };
      }
    } catch { /* try next url */ }
  }
  return null;
}

/**
 * Update a broadcast task's status once receipt is found.
 * Runs asynchronously — does not block mint execution.
 */
async function watchAndConfirm(taskId, txHash, urls, onUpdate) {
  const deadline = Date.now() + 180_000; // 3 min max
  const poll = async () => {
    if (Date.now() > deadline) return;
    const receipt = await checkReceipt(txHash, urls).catch(() => null);
    if (!receipt) {
      setTimeout(poll, 4000);
      return;
    }
    try {
      await taskStore.updateTaskStatus(taskId, receipt.status, {
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        confirmedAt: new Date().toISOString(),
      });
      if (onUpdate) onUpdate(receipt);
    } catch { /* best-effort */ }
  };
  setTimeout(poll, 5000); // first check 5s after broadcast
}

module.exports = { checkReceipt, watchAndConfirm };
