# RV3 Troubleshooting Guide

## Error: "Cannot connect to server" or `/api/health` returns 404

### Symptoms
- Login page shows "Server not responding"
- `/api/health` returns 404
- `/auth/register` returns 404
- You see HTML error instead of JSON

### Solution

**1. Make sure Node.js is installed (v18+)**
```bash
node --version
# Should show v18.0.0 or higher
```

**2. Stop any existing server**
```bash
# Find process on port 3000
netstat -ano | findstr :3000
# Or on Mac/Linux:
lsof -i :3000
```

**3. Install dependencies**
```bash
cd "c:\Users\RAV3N\Downloads\VIBE CODE\RV3"
npm install
```

**4. Start the server**
```bash
npm start
```

**Should see output like:**
```
  RV3 Mint Bot
  ─────────────────────────────
  UI + API  →  http://localhost:3000
  Auth      →  ✓ login required
  ...
```

**5. Test the server**
Open in browser:
```
http://localhost:3000/health
```

Should return JSON:
```json
{
  "ok": true,
  "status": "Server is running",
  "time": "2024-01-15T10:30:45.123Z",
  "env": "development"
}
```

**6. If still failing, check:**
- Is port 3000 available? (Not blocked by firewall)
- Are there any error messages in the terminal?
- Is Node.js actually running the server?

---

## Error: "Cannot redefine property: ethereum"

### Cause
MetaMask or another Web3 extension is trying to inject `window.ethereum` while we're also trying to set it.

### Solution
✅ This is now fixed in the latest version. The app safely handles this conflict.

**If you still see it:**
1. Disable MetaMask temporarily
2. Clear browser cache (Ctrl+Shift+Delete)
3. Refresh the page (Ctrl+F5)

---

## Error: "Unexpected token 'T'" in JSON parsing

### Cause
Server is returning HTML error page instead of JSON response.

### Solutions

**Check if server is running:**
```bash
npm start
```

**Check server logs for errors:**
Look at the terminal where you ran `npm start`. There should be error messages.

**Common issues:**
- `.env` file missing or has syntax errors
- Node modules not installed: `npm install`
- Port 3000 already in use: Kill the process and restart

---

## Error: "Invalid email or password"

### Causes
1. User hasn't registered yet (first user creates account)
2. Email doesn't match (case-sensitive)
3. Password is incorrect
4. `users.json` file is corrupted

### Solution
1. Click "Create account" to register first user
2. First registered user becomes admin
3. Check browser DevTools (F12) → Console for more details

---

## Error: "Server not responding" or blank page

### Causes
1. Server crashed
2. Port 3000 blocked by firewall
3. Server on wrong port
4. DNS/domain not pointing to server

### Solution

**Local development (localhost:3000):**
```bash
npm start
# Open: http://localhost:3000
```

**Production (your domain):**
1. Server must be accessible from the internet
2. Port 3000 must be open (or reverse proxy to 80/443)
3. Domain must point to server IP
4. Check Nginx is running: `sudo systemctl status nginx`

---

## Error: "Wallets, tasks not syncing"

### Cause
API authentication token missing or expired.

### Solution
1. Login again (clears old token)
2. Clear browser cache
3. Check `.env` has `API_SECRET` set
4. Check server logs for auth errors

---

## How to Debug

### 1. Check server is running
```bash
curl http://localhost:3000/health
# Should return JSON with "ok": true
```

### 2. Check auth endpoint
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'
```

### 3. View server logs
```bash
npm start
# Logs appear in terminal
```

### 4. Check browser console
Press `F12` → Console tab to see JavaScript errors

### 5. Check network tab
Press `F12` → Network tab
- Refresh page
- Look for failed requests (red X)
- Click on failed request to see response

---

## Files to Check

**State file (users & data):**
```
data/users.json       # User accounts (all passwords hashed)
data/state.json       # Wallets, tasks, history
```

**Configuration:**
```
.env                  # Your environment variables
.env.example          # Template
.env.production       # Production template
```

**Server logs:**
```
Terminal where npm start is running
```

---

## Still Stuck?

1. **Restart everything:**
   ```bash
   npm stop
   npm start
   ```

2. **Full clean install:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm start
   ```

3. **Check Node version:**
   ```bash
   node --version  # Should be v18+
   npm --version   # Should be v9+
   ```

4. **Check no other process on port 3000:**
   ```bash
   netstat -ano | findstr :3000
   ```

---

## Production Deployment Issues

See `DEPLOYMENT.md` for:
- VPS/Cloud setup
- Domain configuration
- SSL/HTTPS setup
- Process management with PM2
- Nginx reverse proxy

---

## Still need help?

Check server logs in terminal:
```bash
# Terminal where npm start is running should show:
  RV3 Mint Bot
  ─────────────────────────────
  UI + API  →  http://localhost:3000
  Auth      →  ✓ login required
```

If you see errors there, that's where to start debugging.
