# RV3

Private NFT minting and execution console with multi-chain RPC routing, encrypted wallet storage, task automation, copy minting, delegation, and transaction receipts.

## Local setup

```bash
cp .env.example .env
npm ci
npm run check
npm start
```

Set `ADMIN_EMAIL` before starting. On the first visit, initialize that email with a unique password of at least 14 characters. Initial setup closes after the administrator exists.

Keep `ENABLE_LIVE_MINT=false` until the staging checklist in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) is complete. Railway or a persistent VPS/container is recommended because RV3 runs a continuous background worker.

## Required production secrets

- `ADMIN_EMAIL`
- `DATABASE_URL`
- `WALLET_ENCRYPTION_KEY`
- `ETH_RPC_PRIMARY`
- `OPENSEA_API_KEY`

See `.env.example` for optional RPC, builder, alerting, and marketplace integrations. Never commit `.env`, wallet keys, session values, or provider credentials.
