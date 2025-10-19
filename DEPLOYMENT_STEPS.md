# Final Deployment Steps

Your code has been migrated to use Vercel Postgres! Here's what you need to do:

## ✅ Already Completed
- [x] Installed `@vercel/postgres` package
- [x] Updated `database.js` to use Postgres instead of JSON files
- [x] Updated `server.js` to use database functions
- [x] Created migration script for existing data
- [x] Deployed new code to Vercel

## 🔴 CRITICAL: Set Up Postgres Database

**Your deployment will fail until you add a Postgres database!**

### Option 1: Vercel Marketplace (Recommended - New!)

1. **Go to Vercel Marketplace:**
   - Visit: https://vercel.com/marketplace/postgres
   - Or: https://vercel.com/peter-pfaus-projects/family-calendar → Storage tab

2. **Click "Add to Project":**
   - Select `family-calendar` project
   - Database Name: `family-calendar-db`
   - Region: `iad1` (US East) or closest to you
   - Plan: **Free** (Hobby - 256 MB, 60 hrs/month)
   - Click **"Create & Connect"**

3. **Done!** Vercel automatically:
   - Adds `POSTGRES_URL` environment variable
   - Connects it to your deployment
   - No code changes needed
   - Better integration than external providers

**See `VERCEL_MARKETPLACE_SETUP.md` for detailed Marketplace guide.**

### Option 2: Use External Postgres (Neon, Supabase, etc.)

If you prefer an external Postgres provider:

```bash
# Add POSTGRES_URL to Vercel
vercel env add POSTGRES_URL production

# Paste your connection string when prompted
# Example: postgresql://user:password@host:5432/database
```

## 📊 Migrate Existing Data (If You Have Data)

If you have existing users/events in `data/*.json` files:

```bash
# 1. Pull production environment variables
vercel env pull .env.local

# 2. Run migration script
node migrate.js

# 3. Verify data was imported
# (Check your Postgres dashboard or query the database)
```

## 🧪 Test Your Deployment

Visit your production URL:
- **Production URL:** https://family-calendar-theta.vercel.app
- **Latest Deployment:** https://family-calendar-56ilrrevg-peter-pfaus-projects.vercel.app

Try:
1. Register a new account (creates first family)
2. Create an event
3. Invite a family member
4. Import a calendar file

## 🐛 Troubleshooting

### Error: "POSTGRES_URL is not defined"
**Solution:** You haven't added a Postgres database yet. Follow "Option 1" above.

### Error: "relation does not exist"
**Solution:** Tables weren't created. The app auto-creates them on first request. Try refreshing the page.

### Check Logs:
```bash
vercel logs https://family-calendar-theta.vercel.app
```

### Inspect Deployment:
```bash
vercel inspect https://family-calendar-56ilrrevg-peter-pfaus-projects.vercel.app --logs
```

## 📝 What Changed?

### Before (JSON Files):
- ❌ Stored data in `data/users.json`, `data/events.json`, etc.
- ❌ Failed on Vercel (read-only filesystem)
- ❌ Data lost between deployments

### After (Postgres):
- ✅ Stores data in Vercel Postgres database
- ✅ Works perfectly on serverless platform
- ✅ Data persists across deployments
- ✅ Supports concurrent users

## 🎯 Next Steps

1. **Add Postgres database in Vercel dashboard** (5 minutes)
2. Test the app by registering a user
3. (Optional) Migrate existing data with `migrate.js`
4. You're done! 🎉

## Environment Variables Check

Current environment variables in Vercel:
```
✅ REDIS_URL - Session storage
✅ SESSION_SECRET - Session encryption
🔴 POSTGRES_URL - **MISSING - ADD THIS!**
```

Once you add `POSTGRES_URL`, your app will work perfectly!
