'use strict';

const rpc = require('./rpc');

const CHAINS = Object.freeze({
  ethereum: { label: 'Ethereum', chainId: 1, native: 'ETH' },
  robinhood: { label: 'Robinhood Chain', chainId: 4663, native: 'ETH' },
  base: { label: 'Base', chainId: 8453, native: 'ETH' },
  blast: { label: 'Blast', chainId: 81457, native: 'ETH' },
  polygon: { label: 'Polygon', chainId: 137, native: 'POL' },
});
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function validateTaskInput(body = {}) {
  const chainSlug = rpc.normalizeChain(body.chainSlug || 'ethereum');
  if (!CHAINS[chainSlug]) throw new Error('Unsupported production network');
  const contractAddress = String(body.contractAddress || '').trim();
  if (contractAddress && !ADDRESS.test(contractAddress)) throw new Error('contractAddress must be a valid EVM address');
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null;
  if (body.scheduledAt && Number.isNaN(new Date(body.scheduledAt).getTime())) throw new Error('scheduledAt must be an ISO date/time');
  const targetBlock = body.targetBlock == null || body.targetBlock === '' ? null : Number(body.targetBlock);
  if (targetBlock != null && (!Number.isSafeInteger(targetBlock) || targetBlock < 1)) throw new Error('targetBlock must be a positive block number');
  if (scheduledAt && targetBlock != null) throw new Error('Choose either scheduledAt or targetBlock, not both');
  return { chainSlug, contractAddress: contractAddress || null, scheduledAt, targetBlock };
}

function checklist(task, wallets) {
  const chain = rpc.normalizeChain(task.chainSlug);
  const rpcUrls = rpc.allRpcUrls(task.rpcUrls || [], chain);
  const count = Math.min(Number(task.wallets) || 1, wallets.length);
  return [
    { id: 'network', ok: !!CHAINS[chain], message: CHAINS[chain]?.label || 'Unsupported network' },
    { id: 'contract', ok: ADDRESS.test(String(task.contractAddress || '')), message: 'Contract address is required and must be allowlisted before live use' },
    { id: 'rpc', ok: rpcUrls.length > 0, message: `${rpcUrls.length} approved RPC endpoint(s)` },
    { id: 'wallets', ok: count >= (Number(task.wallets) || 1), message: `${count}/${task.wallets || 1} watch-only wallet address(es) available` },
    { id: 'signer', ok: false, message: 'External signer provider is not connected' },
    { id: 'policy', ok: false, message: 'Live policy/contract allowlist must be configured' },
    { id: 'confirmation', ok: task.executionApproved === true, message: task.executionApproved ? 'Operator confirmation recorded' : 'Operator confirmation required before any live attempt' },
  ];
}

function summary(task, wallets) {
  const checks = checklist(task, wallets);
  return {
    taskId: task.id,
    chain: rpc.normalizeChain(task.chainSlug),
    mode: task.targetBlock ? 'block' : task.scheduledAt ? 'time' : 'manual',
    checks,
    readyForPreflight: checks.filter(c => ['network', 'rpc', 'wallets'].includes(c.id)).every(c => c.ok),
    readyForLive: checks.every(c => c.ok),
  };
}

module.exports = { CHAINS, validateTaskInput, checklist, summary };
