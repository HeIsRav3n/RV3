# RV3 live-release runbook

## Mandatory provider decisions

1. Choose an external transaction signer that returns transaction-specific approvals without giving RV3 signing material.
2. Choose managed or self-hosted RPC providers for Ethereum and Robinhood Chain, with at least two HTTPS endpoints per chain.
3. Choose a read-only event-stream source for public mint observation, including its verification and replay policy.
4. Provision durable Postgres and configure monitoring, backups, HTTPS, and secret rotation.

For WalletConnect, create a dedicated RV3 project, keep its project ID only in
server configuration, and allowlist the final HTTPS RV3 origin in the provider
dashboard. Pair an operator-controlled hardware-backed wallet only through the
RV3 reviewed-request flow. WalletConnect pairing does not authorize automatic
signing or broadcasting.

For Supabase, create the project, use the server-side pooled PostgreSQL connection setting as `DATABASE_URL`, and apply `db/schema.sql` in the SQL editor. Do not expose that connection setting or any service-role credential to the browser.

## Required configuration and policy

- Permit only exact contract addresses and the Ethereum/Robinhood chains for the FCFS workflow.
- Specify per-transaction and daily spending limits, an emergency operator, and an incident contact.
- Leave the circuit breaker enabled until testnet staging has passed.
- Keep `ENABLE_LIVE_MINT=false` until every release check has a recorded owner approval.
- RV3 reserves spending atomically before a reviewed request. A request with no
  broadcast or an execution error releases that reservation; a broadcast settles
  it. Operators should investigate any reservation that remains pending.

## Staging acceptance checks

1. Verify worker status, public-RPC health, and event observation with test data.
2. Confirm a free/public event queues only a preflight task.
3. Confirm a paid, private, unsupported-chain, malformed, or replayed event is rejected.
4. Confirm signer approval, idempotency, allowlists, caps, and circuit breaker all reject unsafe requests.
5. Perform an independent security review before mainnet enablement.
6. Confirm a WalletConnect pairing requests only Ethereum or Robinhood Chain,
   then disconnect it and confirm RV3 fails closed without an approved session.

## Event provider acceptance criteria

The adapter must authenticate every source, deduplicate an event identifier in `rv3_observed_events`, enforce an explicit confirmation/finality policy per chain, and pass only chain, contract, public/free status, and public drop metadata into RV3. It must not provide wallet credentials, signed transactions, or a bypass for contract allowlists.
