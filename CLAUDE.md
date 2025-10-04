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

1. **Server Mode** (`useServer: true`): Uses Express backend with persistent JSON storage
2. **LocalStorage Mode** (`useServer: false`): Falls back to browser localStorage when server unavailable

The client automatically detects server availability and falls back to localStorage if needed.

### File Structure

- `index.html` - Main HTML with extensive inline emoji picker (900+ lines)
- `script.js` - Original client-only implementation (legacy)
- `script-server.js` - Enhanced client with server integration (current)
- `server.js` - Express backend with REST API
- `styles.css` - Application styles
- `data/` - Server-side storage directory (created at runtime)
  - `events.json` - Main events storage
  - `YYYY-MM.json` - Monthly event files (auto-generated)

### Data Flow

**Event Creation/Update/Delete:**
1. Client sends request to `/api/events` endpoints
2. Server updates `events.json`
3. Server automatically creates/updates monthly JSON files (`YYYY-MM.json`)
4. If server unavailable, client falls back to localStorage

**Event Loading:**
- Primary: Load from `/api/events`
- Fallback: Load from localStorage
- Alternative: Load from monthly files via `/api/events/monthly/all`

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

```javascript
{
  id: 'event_<random>',
  title: string,
  date: 'YYYY-MM-DD',
  time: 'HH:MM' | '',
  description: string,
  color: 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'pink',
  emoji: string,  // Single emoji character
  createdAt: ISO timestamp,
  updatedAt: ISO timestamp (optional)
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

### Monthly File System

Server automatically maintains dual storage:
- `events.json`: Complete event list
- `YYYY-MM.json`: Events grouped by month for efficient querying

Both are updated on every write operation via `saveEventsToMonthlyFiles()`.

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
- No authentication/authorization system
- No event recurrence functionality (mentioned in UI but not implemented)
- Export functionality mentioned in kebab menu but not implemented
- File uploads stored temporarily in `uploads/` directory then deleted after processing
- Monthly files accumulate indefinitely (no cleanup mechanism)

## Testing

No automated tests are configured. The `npm test` script exits with error.
