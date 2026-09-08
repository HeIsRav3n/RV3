# RV3 command-center design direction

RV3 will use an original command-center experience inspired by common operator-console patterns: a clear operational path, actionable readiness, concise health visibility, and recovery-first task handling. It will not copy another product's code, branding, or protected workflow logic.

## RV3 information architecture

1. **Command** — current readiness, worker health, operator attention items, and scheduled tasks.
2. **Discover** — public collection and contract research through OpenSea REST, The Graph read models, and approved RPC data.
3. **Campaigns** — a collection record that resolves public metadata, permitted phases, and policy requirements.
4. **Tasks** — filtered queue with readiness, explicit confirmation, retry/skip, and audit trail.
5. **Fleet** — watch-only addresses, per-chain portfolio, funding shortfall plan, and signer association status.
6. **Operations** — preflight, read-only free-mint observation, RPC/event health, and notifications.
7. **Settings** — server-side provider readiness and policy status; no signing material in the browser.

## Original safety differences

- RV3 never imports signing material or silently fires a mint.
- Readiness scores distinguish preparation from authorization.
- Copy-mint observation is restricted to public free mints on Ethereum and Robinhood Chain and creates only an unapproved preflight task.
- A live request must pass durable approval, idempotency, caps, contract allowlist, and external signer checks.
