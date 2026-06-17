# RV3 VPS Monitoring & Maintenance

Monitor your VPS health, application status, and performance.

---

## **Quick Health Check**

Run this from your VPS:

```bash
#!/bin/bash
echo "=== RV3 Health Check ==="
echo ""
echo "App Status:"
pm2 status
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h /opt/RV3
echo ""
echo "System Load:"
uptime
echo ""
echo "Recent Errors:"
pm2 logs rv3 --lines 5
```

Save as `health_check.sh` and run:
```bash
chmod +x health_check.sh
./health_check.sh
```

---

## **Part 1: App Monitoring (PM2)**

### Check App Status

```bash
pm2 status
# Should show: online (green)

pm2 info rv3
# Detailed info: memory, CPU, uptime, restarts
```

### View Real-Time Logs

```bash
pm2 logs rv3
# Ctrl+C to exit

# Last 50 lines
pm2 logs rv3 --lines 50

# Filter by date
pm2 logs rv3 --since "2 hours ago"
```

### Restart if Stuck

```bash
pm2 restart rv3
# Wait 5 seconds for startup

pm2 status  # Verify it came back online
```

### Check for Memory Leaks

```bash
pm2 info rv3
# Look for "Memory" — should be under 200MB normally

# If exceeding 500MB, restart:
pm2 restart rv3
```

---

## **Part 2: System Monitoring**

### Memory Usage

```bash
free -h
# Total, Used, Free

# Watch real-time
watch -n 1 free -h
# Ctrl+C to exit
```

**Healthy**: Free memory > 20% of total

### Disk Space

```bash
df -h /opt/RV3
# Check available space

# See what's using space
du -sh /opt/RV3/*
```

**Healthy**: Free space > 1GB

### CPU Usage

```bash
top
# q to quit

# Or simpler:
htop
```

**Healthy**: CPU usage < 50% on idle

### System Load

```bash
uptime
# Shows load average

# Healthy: load average < number of CPU cores
```

---

## **Part 3: App Endpoint Monitoring**

### Health Endpoint

```bash
curl https://your-domain.com/health
# Should respond with JSON: {"status": "ok"}
```

Add to cron for automated checks:

```bash
# Every 5 minutes, log health check
(crontab -l 2>/dev/null; echo "*/5 * * * * curl -s https://your-domain.com/health >> /opt/RV3/health.log") | crontab -
```

Check logs:
```bash
tail -f /opt/RV3/health.log
```

### Test Login

```bash
curl -X POST https://your-domain.com/auth/verify \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: YOUR_TEST_TOKEN" \
  -d '{}'
```

---

## **Part 4: Web Server Monitoring (Nginx)**

### Check Nginx Status

```bash
sudo systemctl status nginx
# Should show: active (running)
```

### View Access Logs

```bash
sudo tail -f /var/log/nginx/access.log
# Real-time requests

# Last 50 requests
sudo tail -50 /var/log/nginx/access.log
```

### View Error Logs

```bash
sudo tail -f /var/log/nginx/error.log
# Watch for 502, 503 errors

# By volume
sudo grep -c error /var/log/nginx/error.log
```

### Restart if Issues

```bash
sudo nginx -t          # Test config
sudo systemctl restart nginx
```

---

## **Part 5: SSL Certificate Monitoring**

### Check Certificate Expiration

```bash
sudo certbot certificates
# Shows expiration date

# Less than 30 days = renew soon
```

### Manual Renewal (if auto-renewal fails)

```bash
sudo certbot renew --force-renewal
# Certbot auto-renews daily, so this shouldn't be needed
```

### Set Reminder (optional)

```bash
# Add to crontab — email alert 7 days before expiry
(crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet --email your-email@example.com") | crontab -
```

---

## **Part 6: Backup Verification**

### Check Backups Are Running

```bash
ls -lh /opt/RV3/backups/
# Should have daily backups (named with timestamps)

# Count backups
ls /opt/RV3/backups/ | wc -l
```

### Verify Backup Integrity

```bash
# List files in latest backup
tar -tzf /opt/RV3/backups/rv3_backup_LATEST.tar.gz | head -20

# Test extraction
tar -tzf /opt/RV3/backups/rv3_backup_LATEST.tar.gz > /dev/null && echo "Backup OK" || echo "Backup corrupted"
```

### Manual Backup

```bash
/opt/RV3/backup.sh
# Creates timestamped backup in /opt/RV3/backups/
```

### Restore from Backup

```bash
# Stop app
pm2 stop rv3

# Extract backup
tar -xzf /opt/RV3/backups/rv3_backup_TIMESTAMP.tar.gz -C /

# Restart
pm2 restart rv3
```

---

## **Part 7: Automated Alerts**

### Email Alert on App Crash

Create `/opt/RV3/check_health.sh`:

```bash
#!/bin/bash
STATUS=$(pm2 status rv3 | grep -c "online")

if [ $STATUS -eq 0 ]; then
  echo "APP CRASHED" | mail -s "RV3 Alert: App Down" your-email@example.com
  pm2 restart rv3
fi
```

Add to crontab (every 5 minutes):
```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/RV3/check_health.sh") | crontab -
```

### Disk Space Alert

```bash
#!/bin/bash
USED=$(df /opt/RV3 | awk 'NR==2 {print $5}' | sed 's/%//')

if [ $USED -gt 80 ]; then
  echo "Disk 80% full" | mail -s "RV3 Alert: Low Disk" your-email@example.com
fi
```

---

## **Part 8: Performance Monitoring**

### Slow Request Logs

Add to Nginx config to log slow requests:

```bash
sudo nano /etc/nginx/sites-available/rv3
```

Add after `location / {`:
```nginx
proxy_read_timeout 10s;
log_subrequest on;
```

### Monitor RPC Response Times

Add to app logs (in your `/js/api.js`):

```javascript
const start = Date.now();
const response = await fetch(rpcUrl, options);
const duration = Date.now() - start;
console.log(`RPC call took ${duration}ms`);
```

### Check Network Connections

```bash
netstat -an | grep ESTABLISHED | wc -l
# Number of active connections

# Connections by state
netstat -an | awk '{print $6}' | sort | uniq -c
```

---

## **Part 9: Database Monitoring**

### Check User Data File Size

```bash
ls -lh /opt/RV3/data/*.json
# users.json should be < 10MB
# state.json should be < 50MB

# If too large, may need to archive old data
```

### Monitor Data Growth

Add to crontab (daily):
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * du -sh /opt/RV3/data >> /opt/RV3/data_growth.log") | crontab -
```

Check growth:
```bash
cat /opt/RV3/data_growth.log
# Should see gradual increase, not sudden jumps
```

---

## **Part 10: VPS Provider Dashboard**

### DigitalOcean

1. Log into https://cloud.digitalocean.com
2. Click your Droplet name
3. Check:
   - **CPU**: Should be under 50%
   - **Memory**: Should have > 200MB free
   - **Bandwidth**: Monitor for unusual spikes
   - **Graphs**: Look for sustained high usage

### Linode

1. Log into https://cloud.linode.com
2. Click your Linode
3. Check:
   - **Graphs** tab: CPU, Memory, Network
   - **Network** tab: Bandwidth usage
   - **Events** tab: Recent actions/errors

### Hetzner

1. Log into https://console.hetzner.cloud
2. Click your Server
3. Check:
   - **Traffic** tab: Bandwidth
   - **Graphs** tab: CPU, Disk, Network
   - **Console** tab: System logs

---

## **Part 11: Security Monitoring**

### Check Failed SSH Attempts

```bash
sudo grep "Failed password" /var/log/auth.log | wc -l
# High number = brute-force attempts

# Show last 10
sudo grep "Failed password" /var/log/auth.log | tail -10
```

### Enable Fail2Ban (blocks attackers)

```bash
sudo apt-get install -y fail2ban

sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check ban status
sudo fail2ban-client status sshd
```

### Check Open Ports

```bash
sudo netstat -tulpn | grep LISTEN
# Should only see 22 (SSH), 80 (HTTP), 443 (HTTPS)

# Close unexpected ports with firewall
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## **Monitoring Dashboard (Optional)**

### Simple Web Dashboard

Create `/opt/RV3/dashboard.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>RV3 Dashboard</title>
  <style>
    body { font-family: monospace; margin: 20px; }
    .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
    .online { background: #90EE90; }
    .offline { background: #FFB6C6; }
    .warning { background: #FFFFE0; }
  </style>
</head>
<body>
  <h1>RV3 Health Dashboard</h1>
  <div id="status"></div>
  <script>
    async function checkHealth() {
      try {
        const res = await fetch('/health');
        const status = res.ok ? 'online' : 'offline';
        document.getElementById('status').innerHTML = 
          `<div class="status ${status}">App: ${status}</div>`;
      } catch (e) {
        document.getElementById('status').innerHTML = 
          `<div class="status offline">Error: ${e.message}</div>`;
      }
    }
    checkHealth();
    setInterval(checkHealth, 5000); // Check every 5 seconds
  </script>
</body>
</html>
```

Serve at `https://your-domain.com/dashboard.html`

### Better: PM2+ Monitoring

```bash
npm install -g pm2-plus
pm2 plus
# Opens https://app.pm2.io dashboard with your app
```

---

## **Maintenance Schedule**

| Task | Frequency | Command |
|------|-----------|---------|
| Check health | Daily | `pm2 status` |
| Review logs | Daily | `pm2 logs rv3` |
| Verify backups | Weekly | `ls /opt/RV3/backups` |
| SSL renewal | Auto | Runs monthly |
| System updates | Monthly | `apt-get upgrade` |
| Security audit | Monthly | Review logs, check ports |
| Full backup review | Quarterly | Test restore process |

---

## **Alert Thresholds**

| Metric | Warning | Critical |
|--------|---------|----------|
| Memory | > 80% | > 95% |
| Disk | > 70% | > 90% |
| CPU | > 75% | > 95% |
| Error rate | > 1% | > 5% |
| SSL expiry | < 30 days | < 7 days |

---

## **Useful Commands Reference**

```bash
# App
pm2 status              # App status
pm2 logs rv3           # View logs
pm2 restart rv3        # Restart
pm2 stop rv3           # Stop
pm2 start rv3          # Start

# System
free -h                # Memory
df -h                  # Disk
top                    # CPU/Memory details
uptime                 # System load
netstat -an            # Network connections

# Nginx
sudo systemctl status nginx              # Status
sudo systemctl restart nginx             # Restart
sudo tail -f /var/log/nginx/error.log   # Errors

# SSL
sudo certbot certificates                # Check expiry
sudo certbot renew                       # Renew

# Backups
ls /opt/RV3/backups/                    # List backups
/opt/RV3/backup.sh                      # Manual backup

# Security
sudo fail2ban-client status sshd         # Ban status
sudo iptables -L -n                      # Firewall rules
```

---

## **Troubleshooting**

| Problem | Check |
|---------|-------|
| App down | `pm2 logs rv3` for errors |
| High CPU | `top` — kill stuck processes |
| Full disk | `du -sh /opt/RV3/*` — archive old data |
| 502 errors | `sudo systemctl status nginx` |
| SSL errors | `sudo certbot certificates` |
| Can't SSH | Check firewall allows port 22 |
| Backups failing | Check `/opt/RV3/backups` permissions |

---

**Your VPS is monitored!** 📊
