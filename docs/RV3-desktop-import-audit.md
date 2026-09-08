# Desktop RV3 Import Audit

The Desktop RV3 package was reviewed on 2026-09-08 before being used with the
current RV3 workspace. It is a version 2.4.0 deployment snapshot; the active
workspace is version 2.6.0 and contains the server, contract, worker, policy,
and test code that is not present in the Desktop package.

## Adopted compatibility inputs

The current configuration template already supports the non-sensitive setting
names found in the Desktop package:

- Ethereum primary and fallback RPC endpoints
- Robinhood Chain RPC endpoints
- OpenSea, explorer, and optional notification integrations
- Worker interval and task-rate configuration
- Neon-compatible `DATABASE_URL`

When a local configuration is imported, provider values must be placed only in
the ignored local `.env` file. They must never be copied to Git, browser
storage, client-side JavaScript, or task payloads.

## Rejected legacy behavior

The Desktop snapshot includes legacy server-wallet encryption and a live-mint
toggle. Those settings are intentionally not imported as execution authority.
RV3 is non-custodial: private keys and signing material must remain outside the
server, and every live request requires a reviewed external-wallet approval,
durable policy limits, an allowlisted contract, and idempotency protection.

The historical performance notes proposing presigning, automatic copy mints,
or broad builder fan-out are not implemented. They would weaken the current
approval boundary and could bypass project-specific eligibility and mint rules.

## Current source of truth

Use the current workspace files for deployment and operation:

- `.env.example` for supported configuration names
- `docs/RV3-live-release-runbook.md` for production gates
- `docs/RV3-production-readiness-audit.md` for remaining release blockers
- `docs/RV3-command-center-design.md` for the command-center behavior
