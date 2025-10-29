# 📅 Family Calendar

A secure, multi-user family calendar application with role-based access control, emoji support, and **Vercel Postgres** storage.

---

## 🚨 **IMPORTANT: Vercel Deployment Fix Required**

Your app has been **migrated from JSON files to Vercel Postgres** to fix the deployment error.

**📖 Next Steps:** See **[`QUICK_START.md`](./QUICK_START.md)** - Complete setup in 5 minutes!

The code is already deployed - you just need to add the Postgres database via Vercel Marketplace.

---

## ✨ Features

- 🔐 **Secure Authentication**: Password hashing with bcrypt, session-based login
- 👥 **Multi-User Support**: Admin, Adult, and Child roles with different permissions
- 🏠 **Family Isolation**: Each family sees only their own events
- 🔒 **Privacy Controls**: Shared (family-wide) or Private (personal) events
- 📧 **Invitation System**: Admins can invite family members via email
- 😊 **Emoji Support**: Add emojis to events for visual clarity
- 📥 **Import Calendars**: Import from ICS or CSV files
- 🌐 **Production Ready**: Auto-configures for Vercel deployment with Redis sessions

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Visit http://localhost:3000
```

The first user to register becomes the family **admin**.

### Development Mode Features

✅ Uses SQLite for sessions (no setup needed)
✅ HTTP cookies for localhost
✅ All data stored in `./data/` folder
✅ Hot reload with `npm run dev`

## 🔒 User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | • Invite family members<br>• Manage roles<br>• Edit/delete any event |
| **Adult** | • Create/edit own events<br>• View all shared events<br>• Create private events |
| **Child** | • Same as Adult<br>• Cannot change event visibility |

## 📖 Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide for Vercel, Railway, Render
- **[SECURITY.md](./SECURITY.md)** - Security features and API documentation
- **[CLAUDE.md](./CLAUDE.md)** - Architecture and implementation details

## 🌐 Deployment to Vercel

**New: Vercel Marketplace Integration!** 🎉

1. **Add Postgres** (via Marketplace):
   - Visit: https://vercel.com/marketplace/postgres
   - Click "Add to Project" → Select your project
   - Free tier: 256 MB, 60 hours/month
   - Auto-adds `POSTGRES_URL` environment variable

2. **Add KV/Redis** (via Marketplace or Upstash):
   - Option A: https://vercel.com/marketplace/kv (Vercel KV)
   - Option B: https://upstash.com (Upstash Redis)
   - Free tier available for both

3. **Set Session Secret**:
   ```bash
   # Generate secret
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

   # Add to Vercel
   vercel env add SESSION_SECRET
   ```

4. **Deploy**:
   ```bash
   vercel --prod
   ```

**Quick Guides:**
- [`QUICK_START.md`](./QUICK_START.md) - 5-minute setup
- [`VERCEL_MARKETPLACE_SETUP.md`](./VERCEL_MARKETPLACE_SETUP.md) - Marketplace integration
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Detailed deployment guide

## 🛠️ Technology Stack

**Backend:**
- Express.js - Web framework
- bcrypt - Password hashing
- express-session - Session management
- connect-redis - Redis session store (production)
- connect-sqlite3 - SQLite session store (development)

**Frontend:**
- Vanilla JavaScript
- CSS3 with modern flexbox/grid
- Responsive design

**Storage:**
- **Vercel Postgres** for user/family/event data (production)
- Redis/Vercel KV for sessions (production)
- SQLite for sessions (development)
- LocalStorage fallback (client-side)

## 📂 Project Structure

```
Family-Calendar/
├── server.js                     # Express server with auto-config
├── database.js                   # Postgres database operations
├── auth-middleware.js            # Authentication & authorization
├── script-server.js              # Client-side calendar logic
├── index.html                    # Main calendar UI
├── login.html                    # Authentication UI
├── styles.css                    # Application styles
├── vercel.json                   # Vercel deployment config
├── schema.sql                    # Database schema
├── migrate.js                    # JSON to Postgres migration
├── QUICK_START.md                # 5-minute setup guide
├── VERCEL_MARKETPLACE_SETUP.md   # Marketplace integration guide
└── data/                         # Local development only
    ├── sessions.db               # SQLite sessions (dev)
    └── *.json                    # Legacy files (migration only)
```

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Production | Postgres connection (auto-added by Vercel) |
| `SESSION_SECRET` | Production | Secret for session encryption (64+ chars) |
| `NODE_ENV` | Optional | Set to `production` for production mode |
| `PORT` | Optional | Server port (default: 3000) |
| `GMAIL_USER` | Production | Gmail address used to send invitations |
| `GMAIL_APP_PASSWORD` | Production | 16-character Gmail App Password |
| `EMAIL_FROM_NAME` | Optional | Friendly “from” name for outgoing emails |
| `PUBLIC_APP_URL` | Optional | Public base URL used in invitation links |
| `GMAIL_TEST_EMAIL` | Optional | Override test-email destination (defaults to `GMAIL_USER`) |
| `GMAIL_SMTP_HOST` | Optional | Override SMTP host (default: `smtp.gmail.com`) |
| `GMAIL_SMTP_PORT` | Optional | Override SMTP port (default: `465`) |
| `GMAIL_SMTP_SECURE` | Optional | Set to `false` to disable TLS (defaults to `true`) |

## 📝 API Endpoints

### Authentication
```
POST   /api/auth/register     - Register (first user creates family)
POST   /api/auth/login        - Login
POST   /api/auth/logout       - Logout
GET    /api/auth/me           - Get current user
```

### Family Management (Admin only)
```
GET    /api/family/members          - Get family members
POST   /api/family/invite           - Invite member
GET    /api/family/invitations      - Get pending invitations
PUT    /api/family/members/:id/role - Update role
DELETE /api/family/members/:id      - Remove member
POST   /api/family/invitations/:id/resend - Resend a pending invite
DELETE /api/family/invitations/:id        - Cancel a pending invite
GET    /api/admin/sessions          - View recent session log (admin's family)
```

> `GET /api/admin/sessions?limit=50` returns recent sessions for the signed-in admin’s family.  
> Response includes cookie metadata and associated user details; defaults to 50 rows (max 200).

> **Note:** Invitations are stored in the database. Configure Gmail SMTP variables and use the Family Admin → Test Email button to confirm delivery.

## ✉️ Email Delivery (Gmail SMTP)

1. Enable 2-Step Verification on the Gmail account you want to send from.
2. Create an App Password (choose "Mail" → "Other"), copy the 16-character token.
3. Add `GMAIL_USER` (email address) and `GMAIL_APP_PASSWORD` (token) to your environment variables. Optionally set `EMAIL_FROM_NAME`, `PUBLIC_APP_URL`, and `GMAIL_TEST_EMAIL`. SMTP defaults to `smtp.gmail.com:465` with TLS, but you can override via `GMAIL_SMTP_HOST`/`GMAIL_SMTP_PORT` if needed.
4. Redeploy, then open Family Admin → Test Email to confirm Gmail can send before inviting family members.

### Events (Authenticated)
```
GET    /api/events        - Get events (filtered by family)
POST   /api/events        - Create event
PUT    /api/events/:id    - Update event (owner/admin only)
DELETE /api/events/:id    - Delete event (owner/admin only)
POST   /api/import        - Import calendar file
```

See [SECURITY.md](./SECURITY.md) for complete API documentation.

## 🧪 Testing

**Manual Test Flow:**

1. **Register** first user → becomes admin
2. **Create events** → test shared/private visibility
3. **Invite member** → use different browser/incognito
4. **Register invited** → joins family
5. **Test permissions**:
   - Try editing other's events ❌
   - View shared events ✅
   - Create private events ✅

## 🔐 Security Features

✅ Bcrypt password hashing (10 rounds)
✅ HTTP-only session cookies
✅ CSRF protection via session secrets
✅ Role-based authorization
✅ Family data isolation
✅ Secure by default (HTTPS in production)

## 📊 Session Storage

- **Development:** SQLite-backed sessions stored in `./data/sessions.db`
- **Production:** Postgres (Supabase) session table managed via `connect-pg-simple`
- Cookies are HTTP-only, `sameSite='lax'`, and marked `secure` in production

## 🎨 Event Features

- **Emoji picker** with 200+ categorized emojis
- **Color coding** (6 colors)
- **Import support** (ICS, CSV)
- **Auto-detection** of emojis from event titles during import
- **Monthly view** with responsive design
- **Event privacy** (shared/private toggle)

## 🐛 Troubleshooting

**Vercel: "POSTGRES_URL is not defined"**
- You need to add Postgres database from Marketplace
- See [`QUICK_START.md`](./QUICK_START.md)

**Can't login locally?**
- Ensure SQLite is working (should auto-create `data/sessions.db`)
- Check console for errors

**Vercel deployment issues?**
- Verify `POSTGRES_URL`, `REDIS_URL`, and `SESSION_SECRET` are set
- Check Vercel deployment logs: `vercel logs [url]`
- Ensure databases are active in Storage tab

**Database errors?**
- Tables auto-create on first request - just refresh
- Check logs: `vercel logs https://family-calendar-theta.vercel.app`

See [`QUICK_START.md`](./QUICK_START.md) and [DEPLOYMENT.md](./DEPLOYMENT.md) for more help.

## 📜 License

MIT

## 🙏 Acknowledgments

Built with secure authentication patterns and production-ready deployment in mind.

---

**Ready to deploy?** See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions! 🚀
