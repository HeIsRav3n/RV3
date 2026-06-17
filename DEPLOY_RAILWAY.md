# Deploy RV3 to Railway (Recommended)

Railway is the **easiest way** to deploy RV3 because it supports full Node.js servers with persistent storage.

## Why Railway over Vercel?

| Feature | Railway | Vercel |
|---------|---------|--------|
| **Node.js Server** | ✅ Full support | ❌ Serverless only (15s timeout) |
| **Persistent Storage** | ✅ Built-in volumes | ❌ Needs external DB |
| **Background Workers** | ✅ Runs continuously | ❌ Can't run |
| **Setup Time** | ✅ 5 minutes | ❌ 30+ minutes (with DB) |
| **Cost** | ✅ $5/month | ✅ Free tier (limited) |

---

## Deploy to Railway in 5 Steps

### Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub (recommended)
3. Create new project

### Step 2: Connect GitHub Repository
1. Click "New Project"
2. Select "GitHub Repo"
3. Authorize Railway to access your GitHub
4. Choose `HeIsRav3n/RV3` repository

### Step 3: Set Environment Variables
In Railway dashboard, add these variables:

```env
NODE_ENV=production
PORT=8080

# Auth
API_SECRET=generate_a_long_random_string_here

# Wallet encryption (64-char hex)
WALLET_ENCRYPTION_KEY=generate_with_node_command_below

# OpenSea (get from https://docs.opensea.io)
OPENSEA_API_KEY=your_opensea_api_key

# RPC Endpoints (free from alchemy.com)
ETH_RPC_PRIMARY=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_RPC_BLAST_1=https://eth-mainnet.infura.io/v3/YOUR_KEY

# Optional
ETHERSCAN_API_KEY=optional
DISCORD_WEBHOOK_URL=optional
TELEGRAM_BOT_TOKEN=optional
TELEGRAM_CHAT_ID=optional

ENABLE_LIVE_MINT=true
TASK_RATE_LIMIT_PER_MIN=10
```

**Generate secure keys:**
```bash
# Generate API_SECRET (copy entire output)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate WALLET_ENCRYPTION_KEY (copy entire output)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Deploy
Railway auto-deploys when you push to GitHub.

1. Push your code:
```bash
git push origin main
```

2. Watch deployment in Railway dashboard
3. Get your domain: `your-app.railway.app`

### Step 5: Get Your Domain

After deploy completes:
- Railway assigns a domain: `your-app-xxxx.railway.app`
- You can add custom domain in settings
- Open the domain URL and test login!

---

## Test Your Deployment

Once Railway shows "Deployed", test these URLs:

**Health check:**
```
https://your-domain.railway.app/health
```

Should return:
```json
{
  "ok": true,
  "status": "Server is running",
  "env": "production"
}
```

**Login page:**
```
https://your-domain.railway.app
```

Should show login page with RV3 logo.

---

## Add Custom Domain (Optional)

1. Go to Railway dashboard → Settings
2. Click "Custom Domain"
3. Point your DNS to Railway
4. Enable SSL (automatic)

---

## Monitor Your Deployment

In Railway dashboard:
- **Logs** tab: See server output in real-time
- **Metrics** tab: CPU, memory, bandwidth usage
- **Settings** tab: Environment variables, domains

---

## Environment Variables Reference

**Required for login to work:**
- `API_SECRET` — for authentication
- `WALLET_ENCRYPTION_KEY` — for wallet security

**Required for features to work:**
- `OPENSEA_API_KEY` — contract detection
- `ETH_RPC_PRIMARY` — blockchain interaction

**Optional (but recommended):**
- `ETHERSCAN_API_KEY` — contract verification
- `DISCORD_WEBHOOK_URL` — alerts
- `TELEGRAM_BOT_TOKEN` — alerts
- `TELEGRAM_CHAT_ID` — alerts

---

## Troubleshooting

### App won't deploy
1. Check GitHub push succeeded
2. Look at Railway logs for errors
3. Verify environment variables are set

### "Server not responding" after deploy
1. Wait 30 seconds for startup
2. Check logs in Railway dashboard
3. Verify `API_SECRET` is set

### Users can't create accounts
1. Check `API_SECRET` and `WALLET_ENCRYPTION_KEY` are set
2. Look at logs for errors: `data/users.json` might have permission issue
3. Restart deployment: Settings → Redeploy

### Data lost after redeploy
Railway preserves `/data` directory by default. If lost:
1. Configure persistent volume in Railway settings
2. Or use a database (see Vercel section)

---

## Persistent Storage

Your app stores data in `/data` directory:
- `users.json` — user accounts
- `state.json` — wallets, tasks, history

Railway keeps this between deployments. If you need to backup:

```bash
# SSH into Railway container
railway shell

# Backup data
tar -czf backup.tar.gz /app/data
```

---

## Next Steps

1. **Create Railway account** → railway.app
2. **Connect GitHub repo**
3. **Set environment variables** (use keys from above)
4. **Push to GitHub** → Railway auto-deploys
5. **Test your domain** → `your-app.railway.app`
6. **Register first user** → becomes admin
7. **Authorize team emails** from Settings

---

## Railway Pricing

- **Free tier**: Limited hours
- **Pay as you go**: $5/month base + usage
- **Cost for RV3**: Usually $5-10/month (very cheap)

---

## Vercel Alternative (More Complex)

If you really want Vercel, see `DEPLOY_VERCEL.md` for serverless conversion (requires PostgreSQL database).

**Recommended**: Use Railway instead. It's simpler and designed for this.
