# RV3 Mint Bot — Production Deployment Guide

## Overview
RV3 is a fully self-contained Node.js application that can be deployed to any server. This guide covers deployment options and security best practices.

---

## Option 1: VPS/Cloud Server (Recommended)

### Providers
- **AWS EC2** (most popular)
- **DigitalOcean** (easiest)
- **Linode**
- **Hetzner**
- **Azure**
- **Google Cloud**

### Setup Instructions

#### 1. SSH into your server
```bash
ssh root@your-server-ip
```

#### 2. Install Node.js (v18+)
```bash
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

#### 3. Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

#### 4. Clone the repository
```bash
cd /opt
sudo git clone https://github.com/HeIsRav3n/RV3.git
cd RV3
sudo chown -R $USER:$USER /opt/RV3
```

#### 5. Setup environment
```bash
cp .env.production .env
nano .env  # Edit with your production values
```

**Required secrets to update:**
- `ADMIN_EMAIL` — the sole email allowed to initialize the first administrator
- `DATABASE_URL` — required on serverless hosting; recommended for durable sessions
- `WALLET_ENCRYPTION_KEY` — 64-char hex (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `OPENSEA_API_KEY` — from https://docs.opensea.io
- `ETH_RPC_PRIMARY` — your primary Ethereum RPC

#### 6. Install dependencies
```bash
npm install --production
```

#### 7. Start with PM2
```bash
pm2 start server/index.js --name "rv3" --node-args="--watch"
pm2 startup
pm2 save
```

#### 8. Setup Nginx Reverse Proxy
```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/default
```

Replace with:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 9. Get SSL Certificate (Let's Encrypt)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot certonly --standalone -d your-domain.com
```

#### 10. Restart Nginx
```bash
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## Option 2: Heroku (Easiest for beginners)

```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login
heroku login

# Create app
heroku create your-rv3-app

# Set environment variables
heroku config:set ADMIN_EMAIL=you@example.com
heroku config:set WALLET_ENCRYPTION_KEY=your-key
heroku config:set OPENSEA_API_KEY=your-key
heroku config:set ETH_RPC_PRIMARY=https://your-rpc

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

---

## Option 3: Docker (For containerization)

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server/index.js"]
```

Build and run:
```bash
docker build -t rv3-mint-bot .
docker run -d -p 3000:3000 --env-file .env rv3-mint-bot
```

---

## Production Security Checklist

- [ ] Generate new `API_SECRET` (64+ chars, random)
- [ ] Generate new `WALLET_ENCRYPTION_KEY` (64-char hex)
- [ ] Set up HTTPS/SSL certificate
- [ ] Configure firewall to block all ports except 80, 443, 22 (SSH)
- [ ] Use strong SSH keys (disable password auth)
- [ ] Enable fail2ban to block brute-force attacks
- [ ] Set up automated backups of `/data` directory
- [ ] Monitor PM2 with email alerts
- [ ] Use environment variables (never hardcode secrets)
- [ ] Enable HTTP/2 and gzip compression
- [ ] Set up log rotation

---

## Monitoring & Maintenance

### View logs
```bash
pm2 logs rv3
```

### Monitor processes
```bash
pm2 monit
```

### Restart application
```bash
pm2 restart rv3
```

### Check data directory
```bash
ls -la /opt/RV3/data/
```

The `users.json` and `state.json` files contain all user accounts and app state.

---

## Accessing Your App

Once deployed, users access at:
```
https://your-domain.com
```

**First user to register becomes admin** and can authorize additional emails from Settings.

---

## Database Backup

Backup the `data` directory regularly:
```bash
tar -czf rv3-backup-$(date +%s).tar.gz /opt/RV3/data
```

---

## Troubleshooting

### Application won't start
```bash
npm install
pm2 start server/index.js --watch --no-daemon
```

### Users can't log in
- Check `data/users.json` exists
- Check `WALLET_ENCRYPTION_KEY` is set correctly
- Check server logs: `pm2 logs rv3`

### Memory issues
```bash
pm2 stop rv3
pm2 delete rv3
pm2 start server/index.js --name rv3 --max-memory-restart 500M
```

### Port 3000 already in use
```bash
lsof -i :3000
kill -9 <PID>
```

---

## API Key Setup

### OpenSea API Key
1. Go to https://docs.opensea.io
2. Sign up for API access
3. Copy key to `OPENSEA_API_KEY`

### Ethereum RPC Providers
- **Alchemy**: https://www.alchemy.com/ (free tier available)
- **Infura**: https://infura.io/
- **QuickNode**: https://www.quicknode.com/

### Etherscan API Key
1. Go to https://etherscan.io/apis
2. Create account and generate key
3. Copy to `ETHERSCAN_API_KEY`

---

## Support

For issues, check server logs:
```bash
pm2 logs rv3 --lines 100
```

Then check `/data/state.json` for application state and `/data/users.json` for registered accounts.
