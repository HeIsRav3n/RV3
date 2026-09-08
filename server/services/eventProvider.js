'use strict';

// Read-only event-provider boundary. A real adapter must verify source
// authenticity, chain finality/reorg policy, and event uniqueness before RV3
// receives an observation. It never returns a signer or transaction payload.
class EventProvider {
  async start() { throw new Error('Event provider is not configured.'); }
  async stop() {}
  async health() { return { configured: false, mode: 'not_configured' }; }
}

function assertEventProviderConfigured() {
  throw new Error('Automatic event discovery is disabled until an approved read-only event provider and source-verification policy are configured.');
}

module.exports = { EventProvider, assertEventProviderConfigured };
