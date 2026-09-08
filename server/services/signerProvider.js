'use strict';

/**
 * Boundary for a non-custodial signing integration. RV3 deliberately ships
 * without a provider implementation: a provider must be selected, configured,
 * and tested before live execution can be enabled.
 */
class SignerProvider {
  async getAddress() { throw new Error('External signer provider is not configured.'); }
  async getChainId() { throw new Error('External signer provider is not configured.'); }
  async signTransaction() { throw new Error('External signer provider is not configured.'); }
  async signMessage() { throw new Error('External signer provider is not configured.'); }
}

function assertExternalSignerConfigured() {
  throw new Error('Live execution is disabled until an approved external SignerProvider, chain/contract allowlists, spend caps, task idempotency, and circuit breaker are configured.');
}

module.exports = { SignerProvider, assertExternalSignerConfigured };
