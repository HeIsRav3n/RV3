# RV3 production-readiness audit

Date: 2026-09-01

## Scope and verdict

This was a read-only audit of the local RV3 checkout. No transaction, deployment, GitHub write, or signing-material handling occurred.

RV3 has a meaningful fail-closed safety baseline, but it is not production ready and is not a working live-token bot. The supported code-level chain set is Ethereum (1), Robinhood Chain (4663), Base (8453), Blast (81457), and Polygon (137), in server/services/productionPolicy.js:3.

Do not enable ENABLE_LIVE_MINT. The app has no usable external signing provider, incomplete identity and authorization, incomplete durable transaction controls, stale custodial UI, incomplete production testing, and unresolved dependency advisories.

## Architecture and current state

Browser SPA (index.html and js) calls the Express server. The server exposes authentication, task, wallet, RPC, delegation, fund, sweep, and copy-mint routes; it stores state in local JSON or Neon/Postgres; a background worker processes queued state; an external signer boundary is meant to return signatures.

Verified safety controls:

- Both supplied environment templates default live minting off: .env.example:62 and .env.production:34.
- The server rejects custodial wallet preview/import: server/routes/api.js:247-257.
- Production live config requires a signer provider, allowlists, and cap configuration: server/config/validateProductionConfig.js:23-25.
- Task execution calls production policy checks before mint execution: server/routes/api.js:497-499.
- Signer, mint, builder, delegation, fund, and sweep services fail closed because no signer implementation exists: server/services/signerProvider.js:8-16, server/services/mint.js:7-10, server/services/builders.js:9-13.
- Query token fallback was removed: server/middleware/auth.js:9.
- RPC ping only accepts configured endpoints: server/routes/api.js:162-171.
- Login has a rate limit: server/routes/auth.js:5-8 and 24.

## Prioritized findings

### P0-1: External signing is not implemented

Evidence: server/services/signerProvider.js:8-16 only throws; all signing/broadcasting services call this fail-closed boundary.

Impact: RV3 cannot execute an approved live transaction under the selected non-custodial design.

Required upgrade: choose and integrate a hardware wallet bridge, OS secure keystore, or managed signer. It must support account discovery, per-request display, chain switching, cancellation, approved signature return, and audit events without RV3 receiving keys.

### P0-2: Browser still presents custodial-wallet workflows

Evidence: the browser and client methods historically retained custodial input/import flows. The server rejects that flow at server/routes/api.js:247-257.

Impact: the user experience is broken and still invites unsafe key entry.

Required upgrade: replace all custodial input/generation UI and API methods with external-signer connection, public address, chain ID, approval, and status UX.

### P0-3: Password and bootstrap design are unsafe

Evidence: passwords use SHA-256 coupled to API_SECRET at server/services/auth.js:72-73. The first public registrant becomes admin at lines 96-104, and registration remains public at server/routes/auth.js:35.

Impact: an attacker can claim a fresh public deployment; password hashing is unsuitable and API-secret rotation breaks verification.

Required upgrade: Argon2id or bcrypt with versioned migration/reset; one-time installation bootstrap; disable public registration and use admin provisioning.

### P0-4: Sessions are plaintext bearer tokens kept in browser storage

Evidence: tokens are stored as session primary keys at server/services/auth.js:38-45 and queried directly at 148. Browser auth stores tokens in localStorage at js/auth.js:8-27.

Impact: XSS, database exposure, or local compromise can reveal reusable credentials.

Required upgrade: hash tokens at rest, add expiry/revocation/rotation, and use secure HttpOnly sessions with CSRF protection or a hardened short-lived token design. Remove token storage from browser web storage.

### P0-5: Wallets, tasks, and operations have no ownership model

Evidence: wallet and task schemas have no owner field at server/services/wallets.js:39-48 and server/services/taskStore.js:24-31. Delete routes mutate shared state without checking req.session.userId at server/routes/api.js:285-293 and 647-653.

Impact: authenticated users can potentially operate or delete shared resources.

Required upgrade: enforce a single operator with no ordinary accounts, or add owner_user_id and authorization checks to every stored resource and route.

### P0-6: Caps, approvals, and idempotency are only shaped, not enforced

Evidence: productionPolicy requires configuration at lines 25-29 and non-empty approval/idempotency values at line 44, but does not persist uniqueness, account daily spending, or compare transaction value to a cap. The task becomes running before policy checks at server/routes/api.js:481-499.

Impact: a future signer could accept replayed or over-cap requests and leave misleading task state.

Required upgrade: durable immutable transaction intents with payload hash, chain, account, contract, value, approval, cap snapshot, nonce, idempotency key, atomic reservation, and receipt reconciliation.

### P0-7: Not every financial route uses the production policy

Evidence: task run applies policy at server/routes/api.js:497-499. Delegation endpoints only check the environment flag at 797-829; fund/sweep queue operations at 656-716 without the policy.

Impact: a future signing implementation could protect mint tasks but leave other transaction paths exposed.

Required upgrade: centralize execution authorization and apply it to mint, delegation, fund, sweep, copy-mint, retry, and relay/builder routes.

### P1-1: User-supplied RPC URLs remain in state

Evidence: task, fund, and sweep routes accept raw HTTPS RPC URL arrays at server/routes/api.js:335-377 and 656-716.

Impact: future execution could use attacker-controlled endpoints, creating routing/SSRF/availability risk.

Required upgrade: schema validation at every route boundary and configured-RPC IDs only. Do not persist raw client RPC URLs.

### P1-2: Client XSS posture blocks a strict CSP

Evidence: widespread inline handlers and innerHTML rendering at index.html:492, 1117-1124, and 1322-1339. Server headers at server/index.js:18-28 do not include Content-Security-Policy.

Impact: any missed rendering escape or compromised script can expose browser-held credentials.

Required upgrade: externalize handlers/scripts, narrow reviewed DOM sinks, then deploy nonce/hash-based CSP and DOM-XSS tests.

### P1-3: Durable execution is not established

Evidence: JSON state writes occur at server/store.js:35-37 and server/services/taskStore.js:93,115,130. Worker state is process-local at server/services/worker.js:24 and 261-292.

Impact: restart or multi-instance operation can lose state or duplicate transaction work.

Required upgrade: database-backed queue/lease, atomic state transitions, distributed idempotency, worker heartbeat, receipt reconciliation, backup/restore tests, and a durable worker deployment.

### P1-4: Contract owner has broad asset-moving powers without audit-grade tests

Evidence: contracts/RV3BatchMinter.sol:75-82 exposes arbitrary owner call; sweep and withdraw are at 86-113. The contract compiles but has no Solidity unit, fork, or testnet suite.

Impact: owner compromise/misuse can move funds or NFTs; compilation is insufficient assurance.

Required upgrade: multisig/governed owner, reduce generic exec where possible, bytecode provenance, privileged-path tests, fork/testnet rehearsal, independent contract review.

### P1-5: Dependency and CI health are insufficient

Evidence: npm audit reports four unresolved findings, including three high, through express-rate-limit to ip-address and ethers to ws. CI uses npm install rather than npm ci at .github/workflows/ci.yml:18.

Impact: known package exposure remains and CI may not use the reviewed lockfile graph.

Required upgrade: track/update advisories, document compensating controls, use npm ci, add dependency monitoring/SBOM, API/browser/contract/concurrency/fork tests.

### P1-6: Operational logging and secret readiness are incomplete

Evidence: raw error messages are logged at server/index.js:43 and server/services/worker.js:261 and stored at server/store.js:40-44. Deployment secret store, rotation, backups, monitoring, and incident procedures are not present in the checkout.

Impact: future provider failures may leak sensitive metadata and operational recovery is unverified.

Required upgrade: structured redacted logs, audit trail, secrets manager, rotation plan, monitoring, alerts, backup/restore rehearsal, rollback and incident runbook.

## Verification

| Check | Result |
| --- | --- |
| npm test | Pass: 10 targeted safety tests |
| npm run compile:contracts | Pass: RV3BatchMinter compiled |
| git diff --check | Pass: no whitespace errors |
| npm audit --omit=dev --audit-level=high | Fail: 4 findings, 3 high; no direct fix in current graph |

The test suite only proves configuration/policy and fail-closed signer behavior. It does not prove end-to-end wallet connection, signing, live transaction, reconciliation, tenancy isolation, contract behavior, or deployment readiness.

## Release checklist

- [ ] Production external signer selected and validated without RV3 receiving keys.
- [ ] Exact chain and contract allowlists approved and loaded securely.
- [ ] Per-transaction/daily caps, approval, idempotency, circuit breaker, and reconciliation implemented durably.
- [ ] Secure single-operator bootstrap or complete resource ownership enforcement implemented.
- [ ] Password/session migration complete; no auth token in browser storage.
- [ ] Custodial browser UI and client APIs removed.
- [ ] Policy gate applied to every signing-adjacent route.
- [ ] Config-only RPC selection and route schema validation complete.
- [ ] Durable queue/worker, database migrations, backups, monitoring, alerts, and runbooks verified.
- [ ] Dependency advisories resolved or explicitly accepted with compensating controls.
- [ ] CI and independent contract/security review complete before mainnet enablement.

## Required decisions

1. External signing provider and production deployment model.
2. Exact approved contract addresses for each enabled chain.
3. Per-transaction and daily native-token spend caps by chain.
4. Circuit-breaker ownership and operational approval process.
5. Permanent single-operator design or full multi-user authorization model.
