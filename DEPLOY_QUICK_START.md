# RV3 Production Deployment — Quick Start

Choose your platform and follow the steps below.

---

## 🟢 **RECOMMENDED: Railway** (5 minutes)

Railway is the easiest way to deploy RV3 because it fully supports Node.js servers with persistent storage.

### In 5 Steps:

1. **Sign up**: https://railway.app (sign in with GitHub)
2. **New Project** → Select GitHub repo `HeIsRav3n/RV3`
3. **Add environment variables** (see list below)
4. **Railway auto-deploys** when you push to GitHub
5. **Open domain**: `your-app.railway.app`

**Environment Variables Required:**
```
API_SECRET = [generate random string]
WALLET_ENCRYPTION_KEY = [64-char hex key]
OPENSEA_API_KEY = [from opensea.io]
ETH_RPC_PRIMARY = [from alchemy.com free tier]
NODE_ENV = production
```

**Generate keys:**
```bash
# API_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# WALLET_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

→ See **DEPLOY_RAILWAY.md** for full guide

---

## 🟠 **ALTERNATIVE: Vercel** (30+ minutes)

Vercel requires serverless conversion + PostgreSQL database. Only choose this if you specifically need Vercel.

→ See **DEPLOY_VERCEL.md** for full guide

---

## 🟡 **Alternative: Other Platforms**

These also work great with RV3:

| Platform | Time | Cost | Pros |
|----------|------|------|------|
| **Railway** | 5 min | $5/mo | ✅ Easiest, file storage |
| **Render** | 10 min | $7/mo | ✅ Simple, good docs |
| **Fly.io** | 10 min | $5/mo | ✅ Global, fast |
| **DigitalOcean** | 20 min | $5/mo | ✅ Full control, VPS |
| **Heroku** | 10 min | $7/mo | ✅ Simple, reliable |
| **Vercel** | 30 min | $5+DB | ❌ Complex, needs DB |

---

## Deployment Checklist

Before deploying to any platform:

- [ ] Git repo is up to date: `git push origin main`
- [ ] `.env` has all required variables (see above)
- [ ] `WALLET_ENCRYPTION_KEY` is 64-char hex
- [ ] `API_SECRET` is long random string (32+ chars)
- [ ] OpenSea API key obtained (free from opensea.io)
- [ ] RPC endpoint configured (free tier from alchemy.com)

---

## After Deployment

1. **Test health endpoint**: `https://your-domain/health`
2. **Create first account**: Opens login page
3. **First user becomes admin**: Can authorize other emails
4. **Verify in Settings**: Check RPC, OpenSea configured

---

## Domain Setup

**Railway gives free domain:**
- `your-app-xxxx.railway.app` (automatic)

**Add custom domain (optional):**
1. Buy domain (Namecheap, GoDaddy, etc)
2. Point DNS to Railway
3. Enable SSL (automatic)

---

## Environment Variables Full Reference

### Required
```
API_SECRET               Long random string (32+ chars)
WALLET_ENCRYPTION_KEY   64-char hex (from: node -e "...")
OPENSEA_API_KEY         From https://docs.opensea.io
ETH_RPC_PRIMARY         From https://www.alchemy.com
```

### Recommended
```
ETHERSCAN_API_KEY       From https://etherscan.io/apis
ETH_RPC_BLAST_1         Another RPC for failover
ETH_RPC_BLAST_2         Another RPC for failover
```

### Optional
```
DISCORD_WEBHOOK_URL     For alerts (paste Discord webhook)
TELEGRAM_BOT_TOKEN      For alerts (from @BotFather)
TELEGRAM_CHAT_ID        For alerts (your Telegram chat ID)
ENABLE_LIVE_MINT        Set to 'true' for live trading
TASK_RATE_LIMIT_PER_MIN Set to '10' (default)
```

---

## Troubleshooting

**Server won't start:**
- Check `API_SECRET` is set
- Check `WALLET_ENCRYPTION_KEY` is 64-char hex
- Check Node.js logs for errors

**Can't create account:**
- Check `API_SECRET` matches between `.env` and deployment
- Check server logs in platform dashboard

**Can't access RPC:**
- Check `ETH_RPC_PRIMARY` is valid HTTPS URL
- Test locally: `curl https://your-rpc-url`

**Custom domain not working:**
- Wait 24-48 hours for DNS propagation
- Check DNS settings point to platform IP
- Verify SSL certificate in platform dashboard

---

## Get Help

- **Railway issues**: Check docs at railway.app/docs
- **RVC issues**: See TROUBLESHOOTING.md
- **Deployment issues**: See DEPLOYMENT.md

---

## Quick Links

- Railway: https://railway.app
- Alchemy (free RPC): https://www.alchemy.com
- OpenSea API: https://docs.opensea.io
- Etherscan API: https://etherscan.io/apis

---

## One Command Deploy (if using Railway)

After setting up Railway:

```bash
git push origin main
# Railway auto-deploys within 2 minutes
# Check your domain at: https://your-app-xxxx.railway.app
```

That's it! 🚀
