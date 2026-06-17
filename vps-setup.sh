#!/bin/bash
# RV3 Mint Bot — VPS Auto-Setup Script
# Run this once on a fresh Ubuntu 22.04 VPS as root

set -e

echo "🚀 RV3 VPS Setup Starting..."
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Update system
echo -e "${YELLOW}Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

# Install Node.js 18
echo -e "${YELLOW}Installing Node.js 18...${NC}"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 globally
echo -e "${YELLOW}Installing PM2 process manager...${NC}"
npm install -g pm2
pm2 startup
pm2 save

# Install Nginx
echo -e "${YELLOW}Installing Nginx...${NC}"
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# Install Certbot for SSL
echo -e "${YELLOW}Installing Certbot for SSL certificates...${NC}"
apt-get install -y certbot python3-certbot-nginx

# Create app directory
echo -e "${YELLOW}Cloning RV3 repository...${NC}"
mkdir -p /opt
cd /opt
git clone https://github.com/HeIsRav3n/RV3.git
cd /opt/RV3

# Install dependencies
echo -e "${YELLOW}Installing Node dependencies...${NC}"
npm install --production

# Create data directory
mkdir -p /opt/RV3/data

# Create .env file template
echo -e "${YELLOW}Creating .env configuration file...${NC}"
cat > /opt/RV3/.env << 'EOF'
# ── Server Configuration ──────────────────
PORT=3000
NODE_ENV=production

# ── Authentication & Security ────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
API_SECRET=CHANGE_ME_GENERATE_RANDOM

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WALLET_ENCRYPTION_KEY=CHANGE_ME_GENERATE_HEX

# ── OpenSea (required for contract detection) ───
# Get from: https://docs.opensea.io
OPENSEA_API_KEY=

# ── RPC Endpoints (required, HTTPS only) ────────
# Get free from: https://www.alchemy.com
ETH_RPC_PRIMARY=

# Optional RPC endpoints for redundancy
ETH_RPC_BLAST_1=
ETH_RPC_BLAST_2=
ETH_RPC_BLAST_3=
ETH_RPC_PRIVATE=https://rpc.flashbots.net

# ── Optional: Etherscan ──────────────────
ETHERSCAN_API_KEY=

# ── Optional: Alerts ──────────────────────
DISCORD_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Live Trading ──────────────────────────
ENABLE_LIVE_MINT=false

# ── Rate Limiting ────────────────────────
TASK_RATE_LIMIT_PER_MIN=10
EOF

chmod 600 /opt/RV3/.env

# Create Nginx reverse proxy config
echo -e "${YELLOW}Configuring Nginx...${NC}"
cat > /etc/nginx/sites-available/rv3 << 'EOF'
upstream rv3 {
  server 127.0.0.1:3000;
}

server {
  listen 80;
  server_name _;

  # Redirect all HTTP to HTTPS
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name _;

  # SSL certificates will be configured by certbot
  ssl_certificate /etc/letsencrypt/live/DOMAIN/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/DOMAIN/privkey.pem;

  # Security headers
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Referrer-Policy "no-referrer-when-downgrade" always;

  # Compression
  gzip on;
  gzip_vary on;
  gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

  # Proxy to Node.js app
  location / {
    proxy_pass http://rv3;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }
}
EOF

# Enable Nginx site
ln -sf /etc/nginx/sites-available/rv3 /etc/nginx/sites-enabled/rv3
rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
nginx -t

# Start Nginx
systemctl restart nginx

# Start app with PM2
echo -e "${YELLOW}Starting RV3 with PM2...${NC}"
cd /opt/RV3
pm2 start server/index.js --name "rv3" --log-date-format "YYYY-MM-DD HH:mm:ss"
pm2 save

# Setup Certbot timer for auto-renewal
systemctl enable certbot.timer
systemctl start certbot.timer

# Create backup script
echo -e "${YELLOW}Creating backup script...${NC}"
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

# Add daily backup to crontab
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/RV3/backup.sh") | crontab -

# Create systemd service (alternative to PM2)
echo -e "${YELLOW}Creating systemd service...${NC}"
cat > /etc/systemd/system/rv3.service << 'EOF'
[Unit]
Description=RV3 Mint Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/RV3
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Edit configuration:"
echo "   nano /opt/RV3/.env"
echo ""
echo "2. Add your API keys:"
echo "   - API_SECRET (generate random)"
echo "   - WALLET_ENCRYPTION_KEY (64-char hex)"
echo "   - OPENSEA_API_KEY (from opensea.io)"
echo "   - ETH_RPC_PRIMARY (from alchemy.com)"
echo ""
echo "3. Get SSL certificate (replace DOMAIN with your domain):"
echo "   sudo certbot certonly --standalone -d DOMAIN.com"
echo "   sudo sed -i 's/DOMAIN/DOMAIN/g' /etc/nginx/sites-available/rv3"
echo "   sudo systemctl restart nginx"
echo ""
echo "4. Point your domain DNS to this VPS IP"
echo ""
echo "5. Check app status:"
echo "   pm2 status"
echo "   pm2 logs rv3"
echo ""
echo "6. Access your app:"
echo "   https://your-domain.com"
echo ""
echo -e "${YELLOW}App is running on port 3000 (proxied through Nginx)${NC}"
echo -e "${YELLOW}Logs: pm2 logs rv3${NC}"
echo ""
