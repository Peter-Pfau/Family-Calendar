# 🚀 Vercel Deployment - Quick Guide

## Prerequisites (5 minutes)

### 1. Create Upstash Redis Account
1. Go to https://upstash.com
2. Sign up (free)
3. Click **Create Database**
4. Settings:
   - Name: `family-calendar-sessions`
   - Type: **Regional**
   - Region: Choose closest to you
5. Click **Create**
6. **Copy the REST URL** (starts with `redis://...`)

### 2. Generate SESSION_SECRET
Run this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output (long random string).

## Deployment Steps (10 minutes)

### Option 1: Vercel CLI (Fastest)

```bash
# 1. Install Vercel CLI (if not installed)
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy
vercel

# 4. Set environment variables
vercel env add SESSION_SECRET production
# Paste your generated secret

vercel env add REDIS_URL production
# Paste your Upstash Redis URL

# 5. Deploy to production with env vars
vercel --prod
```

Done! Visit your deployment URL.

### Option 2: Vercel Dashboard

#### Step 1: Push to GitHub
```bash
git add .
git commit -m "Ready for Vercel deployment"
git push
```

#### Step 2: Import to Vercel
1. Go to https://vercel.com
2. Click **Add New... → Project**
3. Import your GitHub repository
4. Click **Deploy** (don't wait for it to finish)

#### Step 3: Add Environment Variables
1. Go to **Settings → Environment Variables**
2. Add two variables:

   **Variable 1:**
   - Key: `SESSION_SECRET`
   - Value: (paste your generated secret from step 2)
   - Environment: **Production** ✓

   **Variable 2:**
   - Key: `REDIS_URL`
   - Value: (paste your Upstash Redis URL)
   - Environment: **Production** ✓

3. Click **Save**

#### Step 4: Redeploy
1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **⋯** (three dots) → **Redeploy**
4. Click **Redeploy** again to confirm

## Verify Deployment ✅

Visit your Vercel URL (e.g., `https://family-calendar-xxx.vercel.app`)

You should see:
- ✅ Login page loads
- ✅ Can register first user
- ✅ User becomes admin
- ✅ Can create events
- ✅ Can invite family members

## Environment Variables Reference

| Variable | Where to Get It | Format |
|----------|----------------|--------|
| `SESSION_SECRET` | Generate with Node.js | Long hex string (128+ chars) |
| `REDIS_URL` | Upstash Dashboard | `redis://default:...@upstash.io:6379` |

## How Auto-Detection Works

Your app automatically detects the environment:

```
Local (npm start):
└─> No REDIS_URL found
    └─> Uses SQLite (./data/sessions.db)
    └─> HTTP cookies (secure: false)
    └─> Shows warning about SESSION_SECRET

Vercel (production):
└─> REDIS_URL found
    └─> Uses Redis (Upstash)
    └─> HTTPS cookies (secure: true)
    └─> Enables cross-site cookies
```

## Troubleshooting

### ❌ "SESSION_SECRET warning" shows in Vercel logs

**Solution:**
```bash
vercel env add SESSION_SECRET production
# Paste your secret
vercel --prod
```

### ❌ "Redis connection failed"

**Checklist:**
- [ ] REDIS_URL is set in Vercel dashboard
- [ ] Upstash database shows "Active"
- [ ] Copied the **REST URL** (not Internal URL)
- [ ] URL format: `redis://default:...@...upstash.io:6379`

**Fix:**
1. Go to Upstash dashboard
2. Copy **REST URL** again
3. Update `REDIS_URL` in Vercel
4. Redeploy

### ❌ Users logged out immediately

**Cause:** Cookies not working

**Fix:**
1. Ensure `REDIS_URL` is set (not using SQLite)
2. Verify HTTPS is enabled (automatic on Vercel)
3. Check browser console for cookie errors

### ❌ "Failed to setup session store"

**Solution:**
1. Check Vercel deployment logs
2. Look for exact Redis error
3. Verify Redis URL format
4. Test Redis URL in Upstash dashboard

## Cost

**100% Free for Family Use:**
- ✅ Vercel: Free tier (100GB bandwidth/month)
- ✅ Upstash: Free tier (10,000 commands/day)
- ✅ No credit card required

**Typical usage for 5-person family:**
- ~100 commands/day
- ~3GB bandwidth/month
- **Well within free tier**

## Next Steps

After successful deployment:

1. **Register** the first user (becomes admin)
2. **Invite** family members from Family Admin panel
3. **Bookmark** your Vercel URL
4. **Optional:** Add custom domain in Vercel settings

## Security Checklist

Before sharing with family:

- [x] `SESSION_SECRET` set to secure random value
- [x] `REDIS_URL` connected to Upstash
- [x] HTTPS enabled (automatic on Vercel)
- [x] First user registered as admin
- [x] Test invitation flow works
- [x] Verify event privacy (shared vs private)

## Support

**Issues?**
- Check [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed troubleshooting
- Review [SECURITY.md](./SECURITY.md) for API docs
- See [README.md](./README.md) for feature overview

**Deployment successful?** 🎉
Your Family Calendar is now live and secure!
