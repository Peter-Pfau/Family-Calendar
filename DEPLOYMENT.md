# Deployment Guide

## Vercel Deployment (Recommended)

Your Family Calendar is now configured to automatically work on Vercel with Redis sessions.

### Prerequisites

1. **Vercel Account**: Sign up at https://vercel.com
2. **Redis Database**: Get a free Redis instance from https://upstash.com

### Step 1: Setup Upstash Redis

1. Go to https://upstash.com and sign up
2. Click **Create Database**
3. Choose:
   - **Name**: family-calendar-sessions
   - **Region**: Closest to your users
   - **Type**: Regional (free tier)
4. Click **Create**
5. Copy the **REST URL** (looks like `redis://...`)

### Step 2: Generate SESSION_SECRET

Run this command to generate a secure secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output (it will be a long random string).

### Step 3: Deploy to Vercel

#### Option A: Vercel CLI (Recommended)

1. **Install Vercel CLI**:
```bash
npm install -g vercel
```

2. **Login**:
```bash
vercel login
```

3. **Deploy**:
```bash
vercel
```

4. **Add Environment Variables**:
```bash
# Add SESSION_SECRET
vercel env add SESSION_SECRET production
# Paste your generated secret when prompted

# Add REDIS_URL
vercel env add REDIS_URL production
# Paste your Upstash Redis URL when prompted
```

5. **Redeploy with environment variables**:
```bash
vercel --prod
```

#### Option B: Vercel Dashboard

1. **Push to GitHub**:
```bash
git add .
git commit -m "Add Vercel deployment configuration"
git push
```

2. **Import to Vercel**:
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Click **Deploy**

3. **Add Environment Variables**:
   - Go to **Settings → Environment Variables**
   - Add `SESSION_SECRET` → (your generated secret) → Production
   - Add `REDIS_URL` → (your Upstash Redis URL) → Production

4. **Redeploy**:
   - Go to **Deployments** tab
   - Click the three dots on latest deployment → **Redeploy**

### Step 4: Verify Deployment

1. Visit your Vercel URL (e.g., `https://family-calendar-xxx.vercel.app`)
2. You should see the login page
3. Register a new account
4. Test creating events

### Environment Variables Summary

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SESSION_SECRET` | Yes | Secret for session encryption | `a1b2c3d4e5f6...` (64+ chars) |
| `REDIS_URL` | Yes (Vercel) | Redis connection URL | `redis://default:...@upstash.io:6379` |
| `NODE_ENV` | Auto-set | Environment | `production` |

---

## Alternative Hosting Services

### Netlify

⚠️ Netlify doesn't support WebSockets for Redis well. Use Vercel instead.

### Railway

1. **Create account**: https://railway.app
2. **Create new project** → Deploy from GitHub
3. **Add Redis**:
   - Click **+ New** → **Database** → **Add Redis**
   - Railway will auto-set `REDIS_URL`
4. **Add environment variables**:
   - Go to **Variables**
   - Add `SESSION_SECRET` (your generated secret)
5. Deploy!

### Render

1. **Create account**: https://render.com
2. **New Web Service** → Connect GitHub repo
3. **Add Redis**:
   - Create new **Redis** instance
   - Copy the **Internal Redis URL**
4. **Environment variables**:
   - Add `SESSION_SECRET`
   - Add `REDIS_URL` (paste Redis URL)
5. Deploy!

### Heroku

```bash
# Install Heroku CLI
npm install -g heroku

# Login and create app
heroku login
heroku create family-calendar

# Add Redis
heroku addons:create heroku-redis:mini

# Set environment variables
heroku config:set SESSION_SECRET="your-secret-here"

# Deploy
git push heroku main
```

---

## How It Works

### Auto-Detection System

The app automatically detects the environment:

```javascript
// Local Development (no REDIS_URL set)
→ Uses SQLite sessions (./data/sessions.db)
→ HTTP cookies
→ SESSION_SECRET warning shown

// Production (REDIS_URL set)
→ Uses Redis sessions
→ HTTPS cookies (secure + sameSite)
→ Connects to Upstash/Vercel KV
```

### Session Store Logic

```
IF environment has REDIS_URL or KV_URL:
  ✅ Use Redis (Vercel, Railway, Render, etc.)
ELSE:
  ✅ Use SQLite (local development)
```

### Cookie Configuration

```javascript
Development:
- secure: false (works with http://localhost)
- sameSite: 'lax'

Production:
- secure: true (requires https://)
- sameSite: 'none' (allows cross-site cookies)
```

---

## Troubleshooting

### "SESSION_SECRET warning" in production

**Problem**: Default secret being used

**Solution**:
```bash
vercel env add SESSION_SECRET production
# Enter your generated secret
vercel --prod
```

### "Redis connection failed"

**Problem**: REDIS_URL not set or incorrect

**Solution**:
1. Verify REDIS_URL in Vercel dashboard
2. Check Upstash database is active
3. Ensure you copied the **REST URL** (not Internal URL)

### Users get logged out immediately

**Problem**: Cookie settings incompatible with hosting

**Solution**: Ensure:
- `REDIS_URL` is set (not using SQLite in production)
- Domain is using HTTPS
- `NODE_ENV=production` or `VERCEL=1` is set

### "Failed to setup session store"

**Problem**: Redis connection failed

**Solution**:
1. Check Redis URL format: `redis://...`
2. Verify Upstash database is running
3. Check server logs for exact error

### Can't access family admin features

**Problem**: First user wasn't made admin

**Solution**:
1. Check `data/users.json`
2. First registered user should have `"role": "admin"`
3. If not, manually edit and redeploy

---

## Local Development

To test production mode locally:

```bash
# Install Upstash Redis CLI or use free tier
export REDIS_URL="your-upstash-redis-url"
export SESSION_SECRET="test-secret-for-development"
export NODE_ENV="production"
npm start
```

Or just use SQLite (default):
```bash
npm start
# Automatically uses SQLite in ./data/sessions.db
```

---

## Performance & Scaling

### Redis Session Store Benefits

✅ **Scalability**: Works with serverless/multiple instances
✅ **Performance**: In-memory, extremely fast
✅ **Persistence**: Sessions survive deployments
✅ **Vercel-compatible**: Works with serverless functions

### SQLite Session Store Limitations

❌ **Not serverless-compatible**: File system not persistent
❌ **Single instance**: Doesn't work with load balancers
✅ **Perfect for local dev**: Zero setup required

### Upstash Free Tier Limits

- **10,000 commands/day**: Plenty for family use
- **256 MB storage**: More than enough for sessions
- **Global replication**: Fast worldwide

If you exceed free tier, upgrade is ~$0.20/100k commands.

---

## Security Checklist

Before going live:

- [ ] `SESSION_SECRET` set to secure random value (64+ chars)
- [ ] `REDIS_URL` set (for Vercel deployment)
- [ ] HTTPS enabled (automatic on Vercel)
- [ ] First user registered as admin
- [ ] Test invitation flow
- [ ] Verify events are family-isolated
- [ ] Check authorization (can't edit others' events)
- [ ] Backup `data/` folder (users, families, invitations)

---

## Cost Estimates

**Completely Free Setup:**
- Vercel: Free tier (100GB bandwidth, unlimited deployments)
- Upstash Redis: Free tier (10k commands/day, 256MB storage)
- Total: **$0/month** for typical family use

**If you exceed free tiers:**
- Vercel Pro: $20/month (1TB bandwidth)
- Upstash Pay-as-you-go: ~$0.20/100k commands
- Total: ~$20-25/month for heavy use

---

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Setup Upstash Redis
3. ✅ Configure environment variables
4. ✅ Register first admin user
5. ✅ Invite family members
6. ✅ Backup your data folder

**Your Family Calendar is production-ready!** 🎉
