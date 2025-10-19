# ⚡ Quick Start - Fix Vercel Deployment

## The Problem
Your app was using **JSON files** for storage, which doesn't work on Vercel (read-only filesystem).

## The Solution
✅ **Migrated to Vercel Postgres** (code already deployed)

---

## 🎯 What You Need to Do (5 Minutes)

### Add Postgres Database

**Visit:** https://vercel.com/marketplace/postgres

**Click:** "Add to Project" → Select `family-calendar`

**Configure:**
- Name: `family-calendar-db`
- Region: `iad1` (US East)
- Plan: Free

**Click:** "Create & Connect"

**Done!** ✅

---

### Redeploy

```bash
vercel --prod
```

---

### Test

Visit: https://family-calendar-theta.vercel.app

Try:
- Register account
- Create event
- Invite family member

---

## 📖 Detailed Guides

- **`VERCEL_MARKETPLACE_SETUP.md`** - Marketplace integration guide
- **`VERCEL_POSTGRES_SETUP.md`** - Database setup instructions
- **`DEPLOYMENT_STEPS.md`** - Complete deployment guide
- **`MIGRATION_SUMMARY.md`** - What changed technically

---

## ✅ Checklist

- [x] Code migrated to Postgres
- [x] Code deployed to Vercel
- [ ] **→ Add Postgres from Marketplace** (you are here)
- [ ] Redeploy
- [ ] Test the app

---

## 🆘 Quick Help

**Error: "POSTGRES_URL is not defined"**
→ You need to add Postgres database (see above)

**Error: "relation does not exist"**
→ Refresh page (tables auto-create on first request)

**Check logs:**
```bash
vercel logs https://family-calendar-theta.vercel.app
```

---

**That's it! Just add the database and redeploy.** 🚀
