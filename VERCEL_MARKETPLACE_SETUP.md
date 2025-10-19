# 🚀 Vercel Marketplace Setup (New Method)

Vercel now offers Postgres and KV (Redis) through their **Marketplace** with easier integration!

---

## ⚡ Quick Setup via Marketplace

### Step 1: Add Vercel Postgres (Required)

1. **Go to your project:**
   - https://vercel.com/peter-pfaus-projects/family-calendar

2. **Click "Storage" tab** (top navigation)

3. **Select "Postgres" from Marketplace**
   - Or visit: https://vercel.com/marketplace/postgres
   - Click **"Add to Project"**
   - Select `family-calendar` project

4. **Configure:**
   - Database Name: `family-calendar-db`
   - Region: Choose closest to your deployment (e.g., `iad1` for US East)
   - Plan: **Free** (Hobby plan - 256 MB, 60 hours compute/month)

5. **Click "Create & Connect"**
   - ✅ Automatically adds `POSTGRES_URL` environment variable
   - ✅ Connects to your project
   - ✅ Available immediately

---

### Step 2: Add Vercel KV (Optional but Recommended)

You already have Redis configured, but you can switch to Vercel KV for better integration:

1. **Go to Marketplace:**
   - https://vercel.com/marketplace/kv

2. **Click "Add to Project"**
   - Select `family-calendar` project

3. **Configure:**
   - Store Name: `family-calendar-sessions`
   - Region: Same as Postgres for best performance
   - Plan: **Free** (Hobby - 256 MB, 10k commands/day)

4. **Click "Create & Connect"**
   - ✅ Automatically adds `KV_URL`, `KV_REST_API_URL`, etc.
   - ✅ Your app already supports `KV_URL` (see server.js:14)

**Note:** You can keep your existing Upstash Redis - both work!

---

### Step 3: Redeploy

Trigger a new deployment to use the new database:

```bash
vercel --prod
```

Or push any commit to trigger auto-deployment.

---

## 🎯 Marketplace Benefits

### Vercel Postgres (Free Tier)
- ✅ **256 MB storage**
- ✅ **60 compute hours/month**
- ✅ **Auto-scaling**
- ✅ **Automatic backups**
- ✅ **Zero configuration**
- ✅ **Same region as your app** (low latency)

### Vercel KV (Free Tier)
- ✅ **256 MB storage**
- ✅ **10,000 commands/day**
- ✅ **Upstash-powered** (same backend you're using)
- ✅ **Integrated billing**
- ✅ **No separate account needed**

---

## 🔍 Verify Setup

### Check Environment Variables

In Vercel Dashboard → Settings → Environment Variables, you should see:

```
✅ POSTGRES_URL          (from Vercel Postgres)
✅ KV_URL or REDIS_URL   (from Vercel KV or Upstash)
✅ SESSION_SECRET        (your existing secret)
```

### Test Database Connection

1. **Go to Storage tab**
2. **Click your Postgres database**
3. **Go to "Data" tab**
4. **Run query:**
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   ```
5. **You should see:** `users`, `families`, `events`, `invitations`

---

## 📊 Migrate Existing Data (Optional)

If you have data in local `data/*.json` files:

```bash
# 1. Pull environment variables (includes POSTGRES_URL)
vercel env pull .env.local

# 2. Run migration
node migrate.js

# 3. Verify in Vercel Dashboard → Storage → Data
```

---

## 💰 Cost Comparison

### Option 1: Vercel Marketplace (Recommended)
- **Postgres:** Free tier (256 MB)
- **KV:** Free tier (256 MB)
- **Billing:** Unified with Vercel
- **Setup:** 5 minutes, zero config

### Option 2: External Providers
- **Postgres:** Neon, Supabase, Railway (free tiers available)
- **Redis:** Upstash (your current setup)
- **Billing:** Separate accounts
- **Setup:** Manual environment variable configuration

---

## 🚀 Next Steps

1. ✅ Add Postgres from Marketplace (Required)
2. ✅ (Optional) Switch to Vercel KV for sessions
3. ✅ Redeploy: `vercel --prod`
4. ✅ Test: Visit https://family-calendar-theta.vercel.app
5. ✅ Register an account and create events

---

## 📚 Additional Resources

- **Vercel Postgres Docs:** https://vercel.com/docs/storage/vercel-postgres
- **Vercel KV Docs:** https://vercel.com/docs/storage/vercel-kv
- **Marketplace:** https://vercel.com/marketplace

---

## ❓ FAQ

### Q: Can I use the free tier forever?
**A:** Yes! Vercel's Hobby plan is free indefinitely for personal projects.

### Q: What happens if I exceed free tier limits?
**A:** You'll get notifications. For Hobby plan, you may need to upgrade to Pro.

### Q: Should I use Vercel KV or keep Upstash?
**A:** Both work! Vercel KV is easier (no separate account), but Upstash has larger free tier.

### Q: Can I migrate from Upstash to Vercel KV later?
**A:** Yes, sessions are ephemeral. Just switch `REDIS_URL` to `KV_URL` - no data migration needed.

### Q: How do I check my usage?
**A:** Vercel Dashboard → Storage → [Database] → Usage tab

---

## ✅ Summary

**Old Way (Manual Setup):**
- Find external providers
- Create accounts
- Copy connection strings
- Add environment variables
- Hope they stay in sync

**New Way (Marketplace):**
- Click "Add to Project"
- Click "Create"
- Done! ✨

**Just add Postgres from Marketplace and you're ready to go!** 🎉
