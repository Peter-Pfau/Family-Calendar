# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family Calendar is a web-based calendar application with emoji support. It features a client-server architecture with dual-mode operation (server-backed or localStorage-only).

## Development Commands

### Running the Application

```bash
# Production mode - uses server.js
npm start

# Development mode - auto-restarts on file changes
npm run dev
```

The server runs on port 3000 by default (configurable via `PORT` environment variable).

### Dependencies

```bash
# Install all dependencies
npm install
```

## Architecture

### Dual-Mode Operation

The application can operate in two modes controlled by `script-server.js`:

1. **Server Mode** (`useServer: true`): Uses Express backend with Vercel Postgres database
2. **LocalStorage Mode** (`useServer: false`): Falls back to browser localStorage when server unavailable

The client automatically detects server availability and falls back to localStorage if needed.

### Database Storage

**Production (Vercel):** Uses Vercel Postgres for all data storage
**Development (Local):** Can use Postgres or localStorage fallback

All data stored in Postgres tables:
- `families` - Family accounts
- `users` - User accounts with bcrypt passwords
- `invitations` - Pending family invitations
- `events` - Calendar events with ownership and visibility

### File Structure

- `index.html` - Main HTML with extensive inline emoji picker (900+ lines)
- `script.js` - Original client-only implementation (legacy)
- `script-server.js` - Enhanced client with server integration (current)
- `server.js` - Express backend with REST API
- `database.js` - Postgres database operations using @vercel/postgres
- `auth-middleware.js` - Authentication and authorization middleware
- `styles.css` - Application styles
- `schema.sql` - Database schema definition
- `migrate.js` - Migration script for JSON to Postgres conversion
- `data/` - Local development only (not used in production)
  - Legacy JSON files (users.json, events.json, etc.) - only for migration

### Data Flow

**Event Creation/Update/Delete:**
1. Client sends request to `/api/events` endpoints
2. Server validates authorization (owner or admin only)
3. Server executes SQL query to insert/update/delete in Postgres
4. Postgres returns updated data
5. If server unavailable, client falls back to localStorage

**Event Loading:**
- Primary: Load from Postgres via `/api/events`
- Fallback: Load from localStorage
- Queries filtered by family_id and visibility (shared vs private)

### API Endpoints

```
GET    /api/events              - Get all events
GET    /api/events/:year/:month - Get events for specific month
GET    /api/events/monthly/all  - Load all events from monthly files
POST   /api/events              - Create new event
PUT    /api/events/:id          - Update event
DELETE /api/events/:id          - Delete event
POST   /api/import              - Import calendar file (ICS/CSV)
```

### Event Data Structure

**Database Schema (Postgres):**
```sql
CREATE TABLE events (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    date DATE NOT NULL,
    time VARCHAR(10),
    description TEXT,
    color VARCHAR(50) DEFAULT 'blue',
    emoji VARCHAR(10),
    owner_id VARCHAR(255) REFERENCES users(id),
    family_id VARCHAR(255) REFERENCES families(id),
    visibility VARCHAR(50) DEFAULT 'shared',  -- 'shared' or 'private'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);
```

**JavaScript Object:**
```javascript
{
  id: 'event_<random>',
  title: string,
  date: 'YYYY-MM-DD',
  time: 'HH:MM' | '',
  description: string,
  color: 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'pink',
  emoji: string,  // Single emoji character
  owner_id: string,  // User ID who created the event
  family_id: string, // Family ID
  visibility: 'shared' | 'private',
  created_at: ISO timestamp,
  updated_at: ISO timestamp (optional)
}
```

### File Upload & Parsing

The server handles two calendar import formats:

1. **ICS (iCalendar)**: Parses `VEVENT` blocks, extracts SUMMARY, DTSTART, DESCRIPTION
2. **CSV**: Expected columns: title, date, time, description (header row optional)

Both formats trigger automatic emoji detection based on event titles (see `detectEmojiFromTitle()` in server.js:406-463).

### Emoji System

**Two implementations exist:**
- Client-side emoji picker in HTML (10 categories, 200+ emojis)
- Server-side emoji detection during import (50+ keyword patterns)

Keywords mapped to emojis include sports (basketball 🏀, football 🏈), celebrations (birthday 🎂, party 🎉), work/school (meeting 💼, exam ✏️), health (doctor 🏥, gym 🏋️), travel (flight ✈️, vacation 🏖️), and more.

## Important Implementation Details

### Database Operations

All data operations use SQL queries via `@vercel/postgres`:
```javascript
// Example: Get events for family
const events = await sql`
  SELECT * FROM events
  WHERE (family_id = ${familyId} AND visibility = 'shared')
     OR (owner_id = ${userId} AND visibility = 'private')
  ORDER BY date ASC
`;
```

**Key Functions in `database.js`:**
- `createEvent()` - Insert new event
- `getEventsByFamily()` - Query events with authorization filter
- `getEventsByMonth()` - Query events by date range
- `updateEvent()` - Update event fields
- `deleteEvent()` - Delete event
- `bulkCreateEvents()` - Bulk import events

### Client Initialization

`script-server.js` initializes with:
1. Event listener setup (modals, forms, navigation)
2. Async event loading from server (with localStorage fallback)
3. Calendar rendering for current month

### Date Parsing

The server supports multiple date formats via `parseDate()`:
- ISO: `YYYY-MM-DD`
- US: `MM/DD/YYYY`
- Short: `MM/DD/YY` (assumes 20xx)
- Flexible: `M/D/YYYY`

### Modal System

Four modal types:
1. Event Add/Edit (`event-modal`)
2. Import (`import-modal`)
3. Event Details (`event-details-modal`)
4. Schedules & Resources (`schedules-modal`) - UI shell only, features not implemented

## Known Limitations

- `schedules-modal` buttons (personal schedules, recurring events, school/work schedules) have no backend implementation
- No event recurrence functionality (mentioned in UI but not implemented)
- Export functionality mentioned in kebab menu but not implemented
- File uploads stored temporarily in `uploads/` directory then deleted after processing

## Security & Authentication

### Multi-User Authentication System

The app implements role-based access control with three user types:
- **Admin**: Full control (first user auto-promoted)
- **Adult**: Can create/edit own events, view all shared events
- **Child**: Same as Adult but restricted from changing event ownership/visibility

### Session Management

**Dual-mode session storage** with automatic detection:
- **Development** (`npm start` locally): SQLite sessions in `./data/sessions.db`
- **Production** (Vercel/Redis): Redis-based sessions via `REDIS_URL` env var

Session configuration auto-adjusts:
```javascript
if (REDIS_URL exists):
  → Redis store (connect-redis)
  → secure cookies enabled
  → sameSite='none' for cross-site
else:
  → SQLite store (connect-sqlite3)
  → secure=false for localhost
  → sameSite='lax'
```

### Event Authorization

All event operations filtered by:
1. **Family isolation**: Users only see their family's events
2. **Visibility**: Shared (all family) vs Private (owner only)
3. **Ownership**: Only owner or admin can edit/delete

Children have additional restrictions preventing visibility/ownership changes.

### Environment Variables

Required for production:
- `SESSION_SECRET`: Cryptographic secret for session signing (64+ random chars)
- `REDIS_URL` or `KV_URL`: Redis connection string (Upstash, Vercel KV, etc.)
- `NODE_ENV=production` or `VERCEL=1`: Triggers production mode

### Database

**Postgres Tables:**
- `users`: User accounts (bcrypt-hashed passwords, role-based access)
- `families`: Family metadata
- `invitations`: Pending invitations (7-day expiry)
- `events`: Events with owner/family/visibility metadata and foreign keys

**Local Development Only:**
- `data/sessions.db`: SQLite sessions (when REDIS_URL not set)
- `data/*.json`: Legacy JSON files (only for migration to Postgres)

## Deployment

### Vercel (Recommended)

Fully configured for Vercel deployment with `vercel.json`:

**Prerequisites:**
1. Set up Vercel Postgres database (Storage → Create Database → Postgres)
2. Set up Upstash Redis for sessions (free tier: https://upstash.com)
3. Set environment variables in Vercel:
   - `POSTGRES_URL` - Auto-added by Vercel Postgres
   - `SESSION_SECRET` - Generate via `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
   - `REDIS_URL` - From Upstash dashboard

**Deploy:**
```bash
vercel --prod
```

**Migrate existing data (optional):**
```bash
vercel env pull .env.local
node migrate.js
```

Auto-detects Vercel environment and switches to:
- Postgres database for all data
- Redis sessions (Upstash/Vercel KV)
- HTTPS-only cookies
- Cross-site cookie support

See `DEPLOYMENT_STEPS.md` for complete setup guide and `MIGRATION_SUMMARY.md` for architecture details.

### Local Testing of Production Mode

```bash
# Set environment variables
export POSTGRES_URL="postgresql://user:password@host:5432/database"
export REDIS_URL="your-redis-url"
export SESSION_SECRET="test-secret"
export NODE_ENV="production"

# Run server
npm start
```

Or use Vercel's environment variables locally:
```bash
vercel env pull .env.local
npm start
```

## Testing

No automated tests are configured. The `npm test` script exits with error.

Manual testing checklist in `SECURITY.md`:
- Register first user (becomes admin)
- Invite family members
- Test role permissions
- Verify event visibility (shared vs private)
- Confirm authorization (can't edit others' events)
