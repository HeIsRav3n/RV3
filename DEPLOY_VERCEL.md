# Deploy RV3 to Vercel (Alternative - More Complex)

⚠️ **Note**: Vercel is serverless and requires significant changes. **Railway is recommended instead** (see DEPLOY_RAILWAY.md).

If you must use Vercel, this guide converts RV3 to serverless architecture.

---

## Vercel Requirements

Vercel doesn't support:
- ❌ Long-running Node.js servers
- ❌ Persistent file storage
- ❌ Background worker processes
- ❌ 15-second execution limit

**You need:**
- ✅ PostgreSQL database (Vercel Postgres, Neon, or Supabase)
- ✅ Serverless function conversion
- ✅ Vercel KV for session storage
- ✅ Scheduled functions instead of workers

---

## Step 1: Set Up Database

### Option A: Vercel Postgres (Recommended for Vercel)
```bash
vercel env add DATABASE_URL
# Use Vercel Postgres connection string
```

### Option B: Neon (Free PostgreSQL)
1. Go to https://neon.tech
2. Create account
3. Create database
4. Copy connection string
5. Add to Vercel: `DATABASE_URL=postgresql://...`

### Option C: Supabase
1. Go to https://supabase.com
2. Create project
3. Copy PostgreSQL connection string
4. Add to Vercel

---

## Step 2: Database Schema

Create tables for persistent storage:

```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  is_admin BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- State table (wallets, tasks, etc)
CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Logs table
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  level TEXT,
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Step 3: Vercel KV Setup

```bash
vercel env add KV_REST_API_URL
vercel env add KV_REST_API_TOKEN
```

Get these from Vercel dashboard → Storage → Create KV Database

---

## Step 4: Convert to Serverless

Create `/api` directory for Vercel serverless functions:

```
api/
├── auth/
│   ├── login.js
│   ├── register.js
│   ├── verify.js
│   └── logout.js
├── health.js
└── wallets.js
```

Example `/api/auth/login.js`:
```javascript
import { sql } from '@vercel/postgres';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const hash = crypto.createHash('sha256').update(password + process.env.API_SECRET).digest('hex');

    if (user.password_hash !== hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO sessions (token, user_id, is_admin, expires_at)
      VALUES (${token}, ${user.id}, ${user.is_admin}, ${expiresAt})
    `;

    res.json({
      token,
      user: { id: user.id, email: user.email, isAdmin: user.is_admin }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
```

---

## Step 5: Update Frontend API Client

Modify `/js/auth.js` to use serverless endpoints:

```javascript
async login(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  this.setToken(data.token);
  this.setUser(data.user);
  return data;
}
```

---

## Step 6: Deploy to Vercel

```bash
npm install -D @vercel/postgres

git add .
git commit -m "feat: convert to Vercel serverless with PostgreSQL"
git push origin main

vercel
```

---

## Issues with Vercel Approach

1. **Complex migration** — Requires database setup
2. **No background workers** — Task runner won't work
3. **Cold starts** — Slow first request after inactivity
4. **Costs** — Database charges add up
5. **Development** — Harder to test locally with PostgreSQL

---

## Recommendation

✅ **Use Railway instead**:
- No database setup needed
- Keep existing code unchanged
- Support for background workers
- Same ease of deployment
- Better pricing
- Simpler debugging

---

## If You Must Use Vercel

1. Set up PostgreSQL database (Neon is free)
2. Convert authentication to serverless functions
3. Convert API routes to serverless functions
4. Use Vercel KV for sessions
5. Remove background worker (or use Vercel Cron jobs)
6. Update frontend API calls

**This is ~500 lines of code changes.**

---

## Vercel + Railway Hybrid

Some teams use:
- **Vercel**: Frontend (static files)
- **Railway**: Backend API (Node.js server)

This gives best of both worlds. See setup guide if interested.

---

## Bottom Line

| Goal | Solution |
|------|----------|
| Deploy fastest | **Railway** (5 mins) |
| Zero config | **Railway** (file-based storage) |
| Want Vercel | **PostgreSQL + serverless** (30+ mins) |
| Production-ready | **Railway** (better scaling) |

**Recommendation: Use Railway.** It's literally designed for this.
