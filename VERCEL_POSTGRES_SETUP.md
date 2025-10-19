# 🚀 Quick Start: Add Postgres to Vercel

Your app has been updated to use **Vercel Postgres** instead of JSON files. Follow these steps to complete the setup:

---

## ⚡ 5-Minute Setup

### Step 1: Add Postgres Database via Marketplace

**New Method (Recommended):**

1. **Go to Vercel Marketplace:**
   - https://vercel.com/marketplace/postgres
   - Or: Project → Storage tab → Browse Marketplace

2. **Click "Add to Project"**
   - Select `family-calendar` project

3. **Configure:**
   - Database Name: `family-calendar-db`
   - Region: `iad1` (US East) or closest to you
   - Plan: **Free** (Hobby - 256 MB, 60 hrs/month)

4. **Click "Create & Connect"**

5. **Done!** ✅
   - Vercel automatically adds `POSTGRES_URL` environment variable
   - Database is connected and ready to use

**Alternative (Classic Method):**
- Project → Storage tab → Create Database → Postgres

---

### Step 2: Redeploy (Trigger with Environment)

Your code is already deployed, but needs to restart with the new `POSTGRES_URL`:

```bash
vercel --prod
```

Or just make any small change and push to trigger auto-deployment.

---

### Step 3: Test Your App

Visit: **https://family-calendar-theta.vercel.app**

Try these actions:
1. **Register** a new account (becomes admin)
2. **Create** a calendar event
3. **Invite** a family member
4. **Import** a calendar file

Everything should work now! 🎉

---

## 🔍 Verify Database Connection

Check if Postgres is working:

1. Go to **Vercel Dashboard** → **Storage** → **family-calendar-db**
2. Click **"Query"** tab
3. Run this query:
   ```sql
   SELECT * FROM users;
   ```
4. You should see your registered users!

---

## 📊 Optional: Migrate Existing Data

If you have existing data in local `data/*.json` files:

```bash
# 1. Download production environment variables
vercel env pull .env.local

# 2. Run migration script
node migrate.js

# 3. Verify data was imported
# Check Vercel dashboard → Storage → Query
```

---

## ❓ Troubleshooting

### Error: "POSTGRES_URL is not defined"
**Fix:** You haven't added the Postgres database yet. Go to Step 1.

### Error: "relation 'users' does not exist"
**Fix:** Tables are auto-created on first request. Just refresh the page.

### Error: "Connection refused"
**Fix:**
- Check Postgres database is created in Vercel dashboard
- Verify `POSTGRES_URL` exists in Environment Variables
- Redeploy: `vercel --prod`

### Check Logs:
```bash
vercel logs https://family-calendar-theta.vercel.app
```

---

## 📦 What Changed?

### Before (JSON Files - Broken on Vercel)
```javascript
// Tried to write files (fails on Vercel)
const events = JSON.parse(fs.readFileSync('data/events.json'));
events.push(newEvent);
fs.writeFileSync('data/events.json', JSON.stringify(events));
// ❌ Error: EROFS: read-only file system
```

### After (Postgres - Works Everywhere)
```javascript
// Uses Postgres database
const events = await sql`SELECT * FROM events WHERE family_id = ${familyId}`;
await sql`INSERT INTO events (...) VALUES (...)`;
// ✅ Works perfectly on Vercel!
```

---

## 🎯 Environment Variables

Your app now needs these variables (check in Vercel dashboard):

| Variable | Status | Source |
|----------|--------|--------|
| `POSTGRES_URL` | 🔴 **Add this!** | Auto-added when you create Postgres database |
| `REDIS_URL` | ✅ Already set | Your Upstash Redis |
| `SESSION_SECRET` | ✅ Already set | Your session secret |

---

## 📚 Additional Documentation

- **`DEPLOYMENT_STEPS.md`** - Detailed deployment guide
- **`MIGRATION_SUMMARY.md`** - Technical architecture changes
- **`POSTGRES_SETUP.md`** - Full Postgres setup guide
- **`schema.sql`** - Database schema
- **`migrate.js`** - Data migration script

---

## ✅ Summary

1. ✅ Code updated to use Postgres
2. ✅ Deployed to Vercel
3. 🔴 **→ Add Postgres database** (5 minutes)
4. ✅ Redeploy
5. ✅ Test the app

**Just add the Postgres database and you're done!** 🚀
