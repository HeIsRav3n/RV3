# RV3 VPS Full Setup Guide

Complete manual setup instructions for deploying RV3 on a VPS.

---

## **Prerequisites**

- VPS with Ubuntu 22.04 LTS (1GB+ RAM, 10GB+ disk)
- SSH access as root
- Domain name (optional but recommended)
- 30 minutes

---

## **Part 1: Initial VPS Setup**

### Create Your VPS

Choose one:
- **DigitalOcean**: digitalocean.com → Create Droplet → Ubuntu 22.04 LTS ($6/mo)
- **Linode**: linode.com → Create Linode → Ubuntu 22.04 LTS ($5/mo)
- **Hetzner**: hetzner.com → Create Server → Ubuntu 22.04 ($3/mo)

**Settings:**
- Size: 1GB RAM minimum (2GB if possible)
- Region: Choose closest to you
- Auth: SSH key (recommended)

### Connect via SSH

```bash
ssh root@YOUR_VPS_IP
```

If using password:
```bash
ssh -o StrictHostKeyChecking=no root@YOUR_VPS_IP
# Enter password when prompted
```

---

## **Part 2: Automated Setup (Recommended)**

Run this single command:

```bash
curl -fsSL https://raw.githubusercontent.com/HeIsRav3n/RV3/main/vps-setup.sh | bash
```

This installs everything automatically:
- Node.js 18
- PM2 (process manager)
- Nginx (reverse proxy)
- Certbot (SSL certificates)
- RV3 app
- Daily backups

**Skip to Part 4** if using automated setup.

---

## **Part 3: Manual Setup (If script fails)**

### Step 1: Update System

```bash
apt-get update
apt-get upgrade -y
```

### Step 2: Install Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs
node --version  # Should show v18.x.x
```

### Step 3: Install PM2

```bash
npm install -g pm2
pm2 startup
pm2 save
```

### Step 4: Install Nginx

```bash
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
```

### Step 5: Install Certbot

```bash
apt-get install -y certbot
```

### Step 6: Clone RV3

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/HeIsRav3n/RV3.git
cd /opt/RV3
npm install --production
```

### Step 7: Create .env File

```bash
nano /opt/RV3/.env
```

Paste this and edit:

```env
PORT=3000
NODE_ENV=production
API_SECRET=your_random_secret_here
WALLET_ENCRYPTION_KEY=your_64_char_hex_here
OPENSEA_API_KEY=your_opensea_key
ETH_RPC_PRIMARY=your_rpc_url
ENABLE_LIVE_MINT=false
```

Save: `Ctrl+X` → `Y` → Enter

### Step 8: Configure Nginx

```bash
cat > /etc/nginx/sites-available/rv3 << 'EOF'
upstream rv3 {
  server 127.0.0.1:3000;
}

server {
  listen 80;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name your-domain.com;

  ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript;

  location / {
    proxy_pass http://rv3;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
```

Enable site:
```bash
ln -sf /etc/nginx/sites-available/rv3 /etc/nginx/sites-enabled/rv3
rm -f /etc/nginx/sites-enabled/default
nginx -t  # Test config
systemctl restart nginx
```

### Step 9: Start App with PM2

```bash
cd /opt/RV3
pm2 start server/index.js --name "rv3"
pm2 save
```

Check it's running:
```bash
pm2 status
pm2 logs rv3
```

---

## **Part 4: SSL Certificate Setup**

```bash
# Replace your-domain.com with your actual domain
sudo certbot certonly --standalone -d your-domain.com

# When prompted, enter your email (for renewal notices)
# Agree to terms
```

Update Nginx config with your domain:
```bash
sed -i 's/your-domain.com/YOUR_ACTUAL_DOMAIN/g' /etc/nginx/sites-available/rv3
sudo systemctl restart nginx
```

---

## **Part 5: Point Domain to VPS**

1. Buy domain (Namecheap, GoDaddy, etc.)
2. Go to registrar DNS settings
3. Find "DNS Management" or "Name Servers"
4. Add `A` record:
   - Host: `@` (or leave blank)
   - Value: Your VPS IP address
   - TTL: 3600
5. Wait 5-30 minutes for DNS propagation

Test:
```bash
nslookup your-domain.com
# Should show your VPS IP
```

---

## **Part 6: Verify Installation**

### Check services are running

```bash
pm2 status
pm2 logs rv3 --lines 20
sudo systemctl status nginx
```

### Test from browser

```
https://your-domain.com
```

Should show:
- Login page with RV3 logo
- Centered layout
- No SSL warnings

### Edit configuration if needed

```bash
nano /opt/RV3/.env
# Make changes
pm2 restart rv3
```

---

## **Part 7: Optional - Setup Backups**

Create backup script:

```bash
cat > /opt/RV3/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/RV3/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
tar -czf $BACKUP_DIR/rv3_backup_$TIMESTAMP.tar.gz /opt/RV3/data
echo "Backup created: $BACKUP_DIR/rv3_backup_$TIMESTAMP.tar.gz"
# Keep only last 7 days
find $BACKUP_DIR -name "rv3_backup_*.tar.gz" -mtime +7 -delete
EOF
chmod +x /opt/RV3/backup.sh
```

Add to cron (daily at 2 AM):
```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/RV3/backup.sh") | crontab -
```

---

## **Useful Commands**

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Check app status
pm2 status

# View logs (real-time)
pm2 logs rv3

# Restart app
pm2 restart rv3

# Stop app
pm2 stop rv3

# Edit config
nano /opt/RV3/.env

# Check system resources
free -h          # Memory
df -h            # Disk
top              # CPU

# Check SSL certificate
sudo certbot certificates

# Renew SSL (automatic, but manual command):
sudo certbot renew

# Restart Nginx
sudo systemctl restart nginx

# View Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check app is listening on port 3000
netstat -tlnp | grep 3000
```

---

## **Troubleshooting**

### App won't start

```bash
pm2 logs rv3
# Look for error messages

# Check .env file
cat /opt/RV3/.env

# Restart
pm2 restart rv3
```

### Domain not resolving

```bash
# Check DNS propagation
nslookup your-domain.com
dig your-domain.com

# Wait up to 24 hours for global propagation
```

### SSL certificate error

```bash
sudo certbot certificates
# Check if cert exists

# Renew if needed
sudo certbot renew
```

### 502 Bad Gateway from Nginx

```bash
# Check if Node.js app is running
pm2 status

# Check Nginx can reach app
curl http://127.0.0.1:3000/health

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### High CPU/Memory usage

```bash
# Check what's using resources
top
htop (if installed)

# Check for stuck processes
pm2 status
ps aux | grep node

# Restart if needed
pm2 restart rv3
```

### Can't SSH to VPS

```bash
# Check VPS is running (from your local computer)
ping YOUR_VPS_IP

# Try different port (if configured)
ssh -p 22 root@YOUR_VPS_IP

# Reset password from VPS provider dashboard
```

---

## **Security Hardening (Optional)**

### Fail2Ban (blocks brute-force)

```bash
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### Firewall (UFW)

```bash
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### Automatic updates

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## **Monitoring (Optional)**

### Email alerts for SSL expiration

```bash
sudo certbot register --email your-email@example.com
```

### Monitor app uptime with PM2+

```bash
npm install -g pm2-plus
pm2 plus
```

### Monitor via VPS provider dashboard

- DigitalOcean: Monitoring tab
- Linode: Longview
- Hetzner: No built-in, use external service

---

## **Costs**

| Item | Cost |
|------|------|
| VPS (DigitalOcean) | $6/month |
| Domain (Namecheap) | $8/year (~$0.67/mo) |
| SSL Certificate | FREE (Let's Encrypt) |
| **Total** | **~$6.67/month** |

---

## **Support**

If you get stuck:
1. Check `pm2 logs rv3` for app errors
2. Check `sudo systemctl status nginx` for web server
3. Check `/opt/RV3/.env` for config errors
4. See `TROUBLESHOOTING.md` for common issues
5. Check `VPS_MONITORING.md` for health checks

---

**Your VPS is ready!** 🚀
