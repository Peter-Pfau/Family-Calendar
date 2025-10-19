# Migration to Vercel Postgres - Summary

## Problem
Your Family Calendar app was using **JSON files** for data storage (`data/users.json`, `data/events.json`, etc.), which doesn't work on Vercel because:
- Vercel has a **read-only filesystem** (serverless)
- File writes fail with permission errors
- Data is lost between deployments

## Solution
Migrated to **Vercel Postgres** for persistent database storage.

---

## Changes Made

### 1. Installed Dependencies
```bash
npm install @vercel/postgres
```

### 2. Updated `database.js`
**Before:** Read/write JSON files
```javascript
const data = await fs.readFile(USERS_FILE, 'utf8');
await fs.writeFile(USERS_FILE, JSON.stringify(users));
```

**After:** Use Postgres SQL queries
```javascript
const result = await sql`SELECT * FROM users WHERE email = ${email}`;
await sql`INSERT INTO users (...) VALUES (...)`;
```

**New functions:**
- `createEvent()` - Insert event into database
- `getEventsByFamily()` - Query events by family
- `getEventsByMonth()` - Query events by date range
- `bulkCreateEvents()` - Import multiple events

### 3. Updated `server.js`
Replaced file operations with database calls:

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /api/events` | `loadEvents()` from file | `db.getEventsByFamily()` |
| `POST /api/events` | Array push + `saveEvents()` | `db.createEvent()` |
| `PUT /api/events/:id` | Array update + `saveEvents()` | `db.updateEvent()` |
| `DELETE /api/events/:id` | Array splice + `saveEvents()` | `db.deleteEvent()` |
| `POST /api/import` | Read file + `saveEvents()` | `db.bulkCreateEvents()` |

### 4. Created Database Schema (`schema.sql`)
```sql
CREATE TABLE families (...);
CREATE TABLE users (...);
CREATE TABLE invitations (...);
CREATE TABLE events (...);
```

### 5. Created Migration Script (`migrate.js`)
For importing existing JSON data into Postgres:
```bash
node migrate.js
```

---

## File Changes Summary

### Modified Files:
- ✏️ `database.js` - Completely rewritten for Postgres
- ✏️ `server.js` - Updated all event endpoints
- ✏️ `package.json` - Added `@vercel/postgres`

### New Files:
- ➕ `schema.sql` - Database schema
- ➕ `migrate.js` - Data migration script
- ➕ `POSTGRES_SETUP.md` - Setup instructions
- ➕ `DEPLOYMENT_STEPS.md` - Deployment guide
- ➕ `MIGRATION_SUMMARY.md` - This file

### Unchanged Files:
- ✅ `index.html` - No changes needed
- ✅ `script-server.js` - No changes needed (uses same API)
- ✅ `auth-middleware.js` - No changes needed
- ✅ `vercel.json` - No changes needed

---

## Next Steps for You

### 🔴 CRITICAL: Add Postgres Database

**New Marketplace Method (Easiest):**

1. Go to: https://vercel.com/marketplace/postgres
2. Click **"Add to Project"** → Select `family-calendar`
3. Configure: `family-calendar-db`, Region `iad1`, Plan **Free**
4. Click **"Create & Connect"**

That's it! Vercel auto-adds `POSTGRES_URL` and connects everything.

**See `VERCEL_MARKETPLACE_SETUP.md` for detailed instructions.**

### Optional: Migrate Existing Data

If you have data in `data/*.json` files:
```bash
vercel env pull .env.local
node migrate.js
```

---

## How It Works Now

### Database Tables
```
families
├── id (PK)
├── name
├── created_by
└── created_at

users
├── id (PK)
├── email (unique)
├── name
├── password (bcrypt)
├── role (admin/adult/child)
├── family_id (FK)
└── created_at

events
├── id (PK)
├── title
├── date
├── time
├── description
├── color
├── emoji
├── owner_id (FK)
├── family_id (FK)
├── visibility (shared/private)
└── created_at
```

### Auto-Initialization
On first request, `initializeDB()` automatically:
1. Creates all tables if they don't exist
2. Creates indexes for performance
3. Sets up foreign key relationships

### Query Examples
```javascript
// Get user's events
const events = await db.getEventsByFamily(familyId, userId);

// Create event
const event = await db.createEvent({
    title: 'Birthday Party',
    date: '2025-10-15',
    ownerId: userId,
    familyId: familyId
});

// Update event
await db.updateEvent(eventId, { title: 'Updated Title' });
```

---

## Benefits

### Before (JSON Files)
- ❌ Filesystem writes fail on Vercel
- ❌ No concurrent access support
- ❌ Data lost on redeployment
- ❌ Manual file management
- ❌ No querying/filtering

### After (Postgres)
- ✅ Works perfectly on serverless
- ✅ Handles concurrent users
- ✅ Data persists forever
- ✅ Automatic backups (Vercel)
- ✅ SQL queries for filtering
- ✅ Indexes for performance
- ✅ Foreign keys for data integrity

---

## Deployment Status

- **Code:** ✅ Deployed to Vercel
- **Database:** 🔴 **Needs setup** (see above)
- **Sessions:** ✅ Already using Redis

**Latest Deployment:**
- URL: https://family-calendar-theta.vercel.app
- Status: Waiting for Postgres setup

Once you add Postgres, the app will work immediately!
