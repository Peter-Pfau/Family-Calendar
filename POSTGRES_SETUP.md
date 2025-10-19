# Vercel Postgres Setup Guide

## Step 1: Create Vercel Postgres Database

1. Go to your Vercel project dashboard: https://vercel.com/dashboard
2. Select your `family-calendar` project
3. Click on the **Storage** tab
4. Click **Create Database**
5. Select **Postgres**
6. Choose a name (e.g., `family-calendar-db`)
7. Select region (choose closest to your users)
8. Click **Create**

## Step 2: Connect Database to Project

Vercel will automatically add these environment variables to your project:
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_USER`
- `POSTGRES_HOST`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`

You don't need to do anything - they're automatically available!

## Step 3: Pull Environment Variables Locally (for migration)

```bash
vercel env pull .env.local
```

This downloads your production environment variables to `.env.local` for local testing.

## Step 4: Run Migration (Optional - if you have existing data)

If you have existing data in `data/*.json` files:

```bash
node migrate.js
```

This will import all your users, families, invitations, and events into Postgres.

## Step 5: Deploy

```bash
vercel --prod
```

The app will now use Postgres instead of JSON files!

## Verification

After deployment, your app should:
- ✅ Create database tables automatically on first run
- ✅ Store all data in Postgres (not local files)
- ✅ Work seamlessly on Vercel's serverless platform

## Troubleshooting

### "Database connection failed"
- Verify `POSTGRES_URL` is set in Vercel dashboard
- Check database is in the same region as your deployment

### "Table does not exist"
- The app auto-creates tables on startup via `initializeDB()`
- Check server logs in Vercel dashboard

### "Migration fails"
- Ensure `.env.local` has `POSTGRES_URL`
- Verify JSON files exist in `data/` directory
- Check for data format issues (missing required fields)

## Environment Variables Summary

### Required (Auto-set by Vercel Postgres):
- `POSTGRES_URL` - Connection string for database

### Already Configured:
- `SESSION_SECRET` - Your session encryption key
- `REDIS_URL` - Your Redis/Upstash connection for sessions

### Optional:
- `NODE_ENV=production` - Auto-set by Vercel
