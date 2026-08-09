# RV3 Production Readiness

## Release decision

RV3 is suitable for a private staging deployment after the required environment variables below are configured. Do not enable live minting until the staging checks and wallet-key backup drill pass.

## Security changes in this release

- Initial setup is restricted to `ADMIN_EMAIL`; arbitrary public registration is closed.
- `ADMIN_EMAIL` is always promoted to administrator and cannot be demoted through the API.
- Passwords require at least 14 characters and are hashed with salted, memory-hard scrypt.
- Existing SHA-256 password hashes are upgraded after the next successful login.
- Sessions expire after eight hours, use `HttpOnly`, `SameSite=Strict` cookies, and are stored as hashes server-side.
- Login and setup are rate-limited. Cross-origin writes are rejected.
- API responses disable caching and expose stricter browser security headers.
- Dependency audit is clean after upgrading `ethers`, `express-rate-limit`, `ws`, and `ip-address` through the lockfile.

## Required configuration

Set these in the host's secret manager, never in Git:

- `NODE_ENV=production`
- `ADMIN_EMAIL`: your primary administrator email, stored only in the host's secret manager
- `DATABASE_URL`: durable Postgres/Neon connection string
- `WALLET_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters
- `ETH_RPC_PRIMARY`: paid, production Ethereum endpoint
- `OPENSEA_API_KEY`: production OpenSea key
- `ENABLE_LIVE_MINT=false` during staging

Optional integrations include the additional RPCs, builder endpoints, Flashbots authentication key, Etherscan, Discord, and Telegram values documented in `.env.example`.

## Hosting recommendation

Use Railway or a VPS/container for the current architecture. RV3 has a continuously running queue worker, so Vercel Functions are not an appropriate production runtime. Use one application instance initially because the queue and worker coordination are process-oriented. Before horizontal scaling, move task claiming to Postgres with row locking or a durable queue such as Redis/BullMQ.

## Go-live sequence

1. Provision Postgres and configure encrypted, automated backups.
2. Deploy with `ENABLE_LIVE_MINT=false` and HTTPS only.
3. Open the app with the configured `ADMIN_EMAIL` and initialize a unique 14+ character administrator password in a password manager. No email, password, or other login secret is committed to this repository.
4. Confirm login, logout, session expiry, rate limiting, and administrator access.
5. Import a disposable test wallet with minimal funds and confirm encryption, restart persistence, and recovery from backup.
6. Test detection, RPC failover, task cancellation, receipts, alerts, and one low-value mint on the intended chain.
7. Add uptime checks for `/health`, application logs, database capacity alerts, RPC latency, and wallet balance thresholds.
8. Restrict deployment access, enable branch protection and required CI checks, then set `ENABLE_LIVE_MINT=true` only after sign-off.

## Scaling work still required

- Replace the in-process worker loop with a durable queue and idempotent job keys.
- Use database transactions and row locks for wallet nonces and task claims.
- Add distributed rate limiting if more than one application instance is used.
- Store encryption keys in a managed KMS and implement key rotation/versioning.
- Add end-to-end browser tests and chain-fork integration tests before handling material funds.
- Split the single-file frontend into tested modules and remove inline scripting so Content Security Policy can drop `unsafe-inline`.

## Operational warning

This application handles blockchain private keys and can submit irreversible transactions. A passing software test suite cannot eliminate smart-contract, RPC, marketplace, key-management, or financial risk. Start with disposable wallets and strict value limits.
