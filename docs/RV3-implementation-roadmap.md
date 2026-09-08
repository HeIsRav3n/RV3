# RV3 safe production roadmap

## Completed in this implementation

1. Removed signing-material intake from the browser and API; wallets are public-address, external-signer records only.
2. Disabled live execution by default and made signer-provider calls fail closed until a real provider is integrated.
3. Replaced browser token persistence with HttpOnly, strict-SameSite cookies; session records store only token digests.
4. Migrated password handling to Argon2id on successful login, retaining legacy verification solely for migration.
5. Restricted operational API routes to the single administrator and gated production account creation to the first bootstrap account.
6. Added production configuration checks, non-custodial/policy tests, contract compilation, dependency auditing, and CI.
7. Added original multi-chain task templates for Ethereum, Robinhood Chain, Base, Blast, and Polygon, with strict chain/address/time/block validation.
8. Added a collection readiness checklist: contract format, approved RPC availability, watch-only wallet capacity, external-signer boundary, policy boundary, and explicit operator confirmation.
9. Added FCFS preparation schedules based on either an ISO time or target block; these modes are mutually exclusive and block targets are polled only through approved chain-specific RPC endpoints.
10. Added approved-endpoint RPC health reporting, per-chain wallet portfolio views, and non-executing funding shortfall plans.
11. Added task audit events and explicit confirmation recording. Confirmation never substitutes for external signer approval, contract allowlisting, spending caps, or project eligibility.

## Product behavior and safety model

RV3 is an original operator console for legitimate collection participation. It prepares read-only collection checks, wallet balances, RPC health, time/block readiness, fee estimates, and a structured task lifecycle. It does not circumvent collection terms, allowlists, anti-bot controls, rate limits, wallet caps, or any other project rule.

Every money-moving path remains fail-closed. A queued task can be preflighted, but live execution additionally requires all of: durable configuration, exact chain and contract allowlists, transaction and daily caps, a recorded operator confirmation, an approval/idempotency request, and an external signer that never discloses signing material to RV3.

## Required before enabling live signing

7. Select and connect an external signer that can create transaction-specific approvals without exposing signing material to RV3.
8. Provision durable Postgres plus a durable job/approval store; persist approval state, idempotency keys, per-transaction caps, daily spend, and circuit-breaker state there.
9. Set a specific allowlist for chains and contracts, maximum value and daily budget, signer identity, emergency operator, and incident response owner.
10. Deploy behind HTTPS with a production `API_SECRET`; use the one-time bootstrap secret only to create the first administrator, then disable bootstrap mode and rotate it.
11. Independently test the external signer in a testnet/staging environment, review each financial route against the policy store, and obtain a security review before any mainnet broadcast.

## Implementation roadmap after this safe build

12. Persist audit events, approvals, idempotency keys, spend reservations, notification delivery attempts, and RPC health snapshots in Postgres; the file store remains development-only.
13. Connect a chosen signer through a narrowly scoped adapter that receives an unsigned, already-policy-checked transaction and returns only a signature or transaction hash.
14. Add staging fixtures for each supported chain and collection-standard adapters only after validating the public contract ABI and project terms.
15. Add dashboard components for the readiness checklist, scheduled-block countdown, RPC health, per-chain portfolio, fee strategy, notifications, and task audit trail using the new API surfaces.
16. Run end-to-end staging tests with test wallets and approved test contracts, then obtain an independent security review before enabling a mainnet signer.

Live broadcasting remains unavailable by design until the release gates above are complete.
