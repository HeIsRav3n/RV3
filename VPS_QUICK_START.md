# RV3 VPS Deployment — Quick Start

Deploy RV3 on your own VPS in **30 minutes**.

---

## **Step 1: Choose Your VPS Provider**

| Provider | Cost | Setup | Recommendation |
|----------|------|-------|-----------------|
| **DigitalOcean** | $6/mo | 5 min | ✅ Best for beginners |
| **Linode** | $5/mo | 5 min | ✅ Great value |
| **Hetzner** | $3/mo | 5 min | ✅ Cheapest |
| **Vultr** | $6/mo | 5 min | ✅ Good performance |
| **AWS EC2** | $0-20/mo | 10 min | Overkill for this |
| **Azure** | Variable | 10 min | Overkill for this |

**Recommended: DigitalOcean** (easiest, best docs)

---

## **Step 2: Create Your VPS**

### DigitalOcean:
1. Go to https://digitalocean.com
2. Create account with credit card
3. Click "Create" → "Droplet"
4. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Size**: Basic ($6/month, 1GB RAM is enough)
   - **Region**: Closest to you
   - **Authentication**: SSH key (recommended) or password
5. Click "Create Droplet"
6. Wait 30 seconds, note the IP address

### Other Providers:
Same process — create Ubuntu 22.04 LTS instance with 1GB+ RAM.

---

## **Step 3: SSH Into Your VPS**

```bash
ssh root@YOUR_VPS_IP
# First time might ask: type "yes" to confirm
```

If you set a password:
```bash
ssh root@YOUR_VPS_IP
# Enter password when prompted
```

---

## **Step 4: Run Setup Script**

Once SSHed into your VPS, run this single command:

```bash
curl -fsSL https://raw.githubusercontent.com/HeIsRav3n/RV3/main/vps-setup.sh | bash
```

This automatically:
- ✅ Installs Node.js 18
- ✅ Installs PM2 (process manager)
- ✅ Installs Nginx (web server)
- ✅ Clones RV3 repo
- ✅ Installs dependencies
- ✅ Configures Nginx reverse proxy
- ✅ Sets up SSL certificate
- ✅ Starts the app

---

## **Step 5: Configure Environment**

```bash
# Edit configuration
nano /opt/RV3/.env
```

Update these variables:
```env
# Generate these:
API_SECRET=generate_long_random_string
WALLET_ENCRYPTION_KEY=generate_64_char_hex

# Get from APIs:
OPENSEA_API_KEY=your_key
ETH_RPC_PRIMARY=your_rpc_url

# Your domain:
NODE_ENV=production
```

**Generate keys:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Press `Ctrl+X`, then `Y` to save.

---

## **Step 6: Get Domain & Point DNS**

1. **Buy domain** (Namecheap, GoDaddy, etc.)
2. **Point to your VPS**:
   - Go to domain registrar DNS settings
   - Add `A` record pointing to your VPS IP
   - Wait 5-30 minutes for propagation

3. **Test**:
```bash
nslookup your-domain.com
# Should show your VPS IP
```

---

## **Step 7: Setup SSL Certificate**

```bash
# First time only:
sudo certbot certonly --standalone -d your-domain.com

# Let certbot auto-renew (already set up by script):
sudo systemctl enable certbot.timer
```

---

## **Step 8: Restart & Verify**

```bash
# Restart the app
pm2 restart rv3

# Check it's running
pm2 status

# Check logs
pm2 logs rv3
```

---

## **Step 9: Test Your App**

Open in browser:
```
https://your-domain.com
```

Should show:
- ✅ Login page with RV3 logo
- ✅ Centered layout
- ✅ No errors

---

## **Step 10: Create First Account**

1. Click "Create account"
2. Register with any email
3. First user = admin
4. You're in! 🎉

---

## **Useful Commands**

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Check app status
pm2 status

# View logs
pm2 logs rv3

# Restart app
pm2 restart rv3

# Stop app
pm2 stop rv3

# Edit config
nano /opt/RV3/.env

# Check system resources
htop

# Check SSL certificate
sudo certbot certificates

# Renew SSL (auto, but manual):
sudo certbot renew
```

---

## **Monitor Your VPS**

Check these in DigitalOcean/Linode dashboard:
- CPU usage
- Memory usage
- Disk space
- Bandwidth
- Billing

---

## **Backup Your Data**

Your user data is stored at:
```
/opt/RV3/data/users.json       # User accounts
/opt/RV3/data/state.json       # Wallets, tasks, history
```

**Backup weekly:**
```bash
tar -czf backup-$(date +%s).tar.gz /opt/RV3/data
# Copy to your computer or backup service
```

---

## **Troubleshooting**

| Issue | Fix |
|-------|-----|
| **App won't start** | `pm2 logs rv3` to see errors |
| **Domain not resolving** | Wait 24h for DNS, check registrar |
| **SSL certificate error** | Run `sudo certbot certificates` |
| **High CPU/Memory** | Check `htop` in VPS terminal |
| **Can't SSH** | Check firewall allows port 22 |

---

## **Scaling Up**

If you outgrow $6/month VPS:
- Upgrade to 2GB RAM droplet ($12/mo)
- Add database (PostgreSQL)
- Load balance with multiple instances
- Use CDN for assets

---

## **Costs Breakdown**

| Item | Cost |
|------|------|
| VPS (DigitalOcean $6/mo) | $6/mo |
| Domain (Namecheap) | $8/year (~$0.65/mo) |
| SSL (Let's Encrypt) | FREE |
| **Total** | **~$6.65/month** |

---

## **Full Documentation**

- Setup: See `VPS_FULL_SETUP.md` for detailed instructions
- Nginx: See `VPS_NGINX_CONFIG.md` for web server config
- Monitoring: See `VPS_MONITORING.md` for uptime alerts
- Troubleshooting: See `TROUBLESHOOTING.md`

---

## **One-Line Deploy**

After VPS creation:
```bash
curl -fsSL https://raw.githubusercontent.com/HeIsRav3n/RV3/main/vps-setup.sh | bash
```

That's it! Your app will be running in 5 minutes.

---

## **Support**

If setup script fails:
1. Run `pm2 logs rv3` to see errors
2. Check SSH access: `ssh root@YOUR_IP`
3. Check Node.js: `node --version` (should be v18+)
4. Check Nginx: `sudo systemctl status nginx`

See `VPS_FULL_SETUP.md` for manual setup if script fails.

---

**Next**: Choose your VPS provider and follow Step 2 above! 🚀
