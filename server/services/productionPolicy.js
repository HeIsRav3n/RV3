'use strict';

const CHAIN_IDS = Object.freeze({ ethereum: 1, robinhood: 4663, base: 8453, blast: 81457, polygon: 137 });
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function splitSet(value) {
  return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function parseWei(value) {
  return /^[0-9]+$/.test(String(value || '')) ? BigInt(value) : null;
}

function readPolicy(env = process.env) {
  return {
    allowedChains: splitSet(env.RV3_ALLOWED_CHAINS),
    allowedContracts: splitSet(env.RV3_ALLOWED_CONTRACTS),
    maxTxValueWei: parseWei(env.RV3_MAX_TX_VALUE_WEI),
    dailySpendWei: parseWei(env.RV3_DAILY_SPEND_WEI),
    circuitBreaker: String(env.RV3_CIRCUIT_BREAKER || 'on').toLowerCase() !== 'off',
    provider: String(env.RV3_EXTERNAL_SIGNER_PROVIDER || '').trim(),
  };
}

function assertLiveReady(policy) {
  if (!policy.provider) throw new Error('RV3_EXTERNAL_SIGNER_PROVIDER is required for live execution.');
  if (!policy.allowedChains.size) throw new Error('RV3_ALLOWED_CHAINS must explicitly allow production chains.');
  if (!policy.allowedContracts.size) throw new Error('RV3_ALLOWED_CONTRACTS must explicitly allow target contracts.');
  if (policy.maxTxValueWei == null || policy.dailySpendWei == null) throw new Error('RV3_MAX_TX_VALUE_WEI and RV3_DAILY_SPEND_WEI are required for live execution.');
}

function assertTaskAllowed(task, policy) {
  if (policy.circuitBreaker) throw new Error('RV3 emergency circuit breaker is engaged.');
  const chain = String(task.chainSlug || '').toLowerCase();
  if (!CHAIN_IDS[chain] || !policy.allowedChains.has(chain)) throw new Error('Task chain is not allowlisted.');
  const contract = String(task.contractAddress || '').toLowerCase();
  if (!ADDRESS.test(contract) || !policy.allowedContracts.has(contract)) throw new Error('Task contract is not allowlisted.');
}

function assertSignatureRequest(request, policy) {
  if (!request || typeof request !== 'object') throw new Error('A structured signature request is required.');
  if (!ADDRESS.test(String(request.from || ''))) throw new Error('External signer account is invalid.');
  if (Number(request.chainId) !== CHAIN_IDS[String(request.chain || '').toLowerCase()]) throw new Error('External signer chain ID does not match the requested chain.');
  if (!request.approvalId || !request.idempotencyKey) throw new Error('Approval ID and idempotency key are required.');
  assertLiveReady(policy);
}

module.exports = { CHAIN_IDS, readPolicy, assertLiveReady, assertTaskAllowed, assertSignatureRequest };
