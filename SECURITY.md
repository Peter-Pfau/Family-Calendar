# Security Features Documentation

## Overview

The Family Calendar now implements **Plan 2: Multi-User with Family Roles** security architecture.

## Features

### User Authentication
- Secure password hashing using bcrypt
- Session-based authentication with HTTP-only cookies
- Session persistence using SQLite

### User Roles
- **Admin**: Full control over family calendar and members
  - Invite new family members
  - Change member roles
  - Remove family members
  - Edit/delete any family event

- **Adult**: Standard family member
  - Create/edit/delete own events
  - View all shared family events
  - Create private events (visible only to themselves)

- **Child**: Restricted access
  - Create/edit/delete own events
  - View all shared family events
  - Cannot change event visibility or ownership

### Event Privacy
- **Shared Events**: Visible to all family members (default)
- **Private Events**: Visible only to the event creator

### Family Management
- First user automatically creates a family and becomes admin
- Invite system allows admins to add family members via email
- Invitations expire after 7 days
- New members join existing family through invitation links

## Getting Started

### First Time Setup

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Navigate to** `http://localhost:3000`

3. **You'll be redirected to the login page** since you're not authenticated

4. **Click "Register"** and create the first account:
   - This user becomes the **family admin**
   - A family is automatically created

5. **Invite family members**:
   - Click "Family Admin" button in the header
   - Enter email addresses to send invitations
   - Choose role for each member (Adult or Child)

6. **Family members register**:
   - They enter their email on the registration page
   - If an invitation exists, they'll see it
   - They complete registration with name and password
   - They're automatically added to your family

## API Endpoints

### Authentication
```
POST   /api/auth/register        - Register new family (first user)
POST   /api/auth/login           - Login with email/password
POST   /api/auth/logout          - Logout and destroy session
GET    /api/auth/me              - Get current user info
```

### Family Management
```
GET    /api/family/members       - Get all family members
POST   /api/family/invite        - Send invitation (admin only)
GET    /api/family/invitations   - Get pending invitations (admin only)
PUT    /api/family/members/:id/role  - Update member role (admin only)
DELETE /api/family/members/:id   - Remove family member (admin only)
```

### Invitations
```
GET    /api/invitations/:email   - Get invitations for email
POST   /api/invitations/:id/accept  - Accept invitation and register
```

### Events (All require authentication)
```
GET    /api/events               - Get events (filtered by family and visibility)
POST   /api/events               - Create event (auto-adds owner and family)
PUT    /api/events/:id           - Update event (owner or admin only)
DELETE /api/events/:id           - Delete event (owner or admin only)
POST   /api/import               - Import calendar file
```

## Event Data Structure

Events now include:
```javascript
{
  id: string,
  title: string,
  date: string,           // YYYY-MM-DD
  time: string,           // HH:MM or empty
  description: string,
  color: string,
  emoji: string,
  ownerId: string,        // User who created the event
  familyId: string,       // Family this event belongs to
  visibility: string,     // 'shared' or 'private'
  createdAt: string,
  updatedAt: string
}
```

## Security Configuration

### Session Secret
**IMPORTANT**: Set a secure session secret in production:

```bash
export SESSION_SECRET="your-secure-random-secret-here"
```

Or create a `.env` file:
```
SESSION_SECRET=your-secure-random-secret-here
```

### HTTPS in Production
For production deployment, set `cookie.secure` to `true` in `server.js`:
```javascript
cookie: {
    secure: true,  // Requires HTTPS
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
}
```

## Database Files

User and family data is stored in JSON files:
- `data/users.json` - User accounts (passwords are hashed)
- `data/families.json` - Family information
- `data/invitations.json` - Pending invitations
- `data/sessions.db` - SQLite session store
- `data/events.json` - All events

**Note**: These files are ignored by git and should be backed up separately.

## Password Requirements

- Minimum 6 characters
- Passwords are hashed using bcrypt with 10 salt rounds
- Password confirmation required during registration

## Session Management

- Sessions last 7 days by default
- Sessions are stored server-side in SQLite
- HTTP-only cookies prevent XSS attacks
- Sessions are destroyed on logout

## Authorization Rules

### Events
- Users can only see events from their family
- Private events are only visible to the owner
- Shared events are visible to all family members
- Only event owner or admin can edit/delete events
- Children cannot change event visibility or ownership

### Family Management
- Only admins can invite new members
- Only admins can change roles or remove members
- Users cannot change their own role
- Users cannot delete their own account (must be removed by another admin)

## Testing

To test the security:

1. Create admin account
2. Create a few events
3. Invite another family member
4. Register as that member (use a different browser/incognito)
5. Try to:
   - View shared events ✓
   - Edit other people's events ✗
   - Access family admin (if not admin) ✗
   - Create private events ✓
   - See only your private events ✓

## Troubleshooting

### "Authentication required" errors
- Make sure cookies are enabled
- Check that the session database exists in `data/sessions.db`
- Verify SESSION_SECRET is set

### Can't login
- Verify email and password are correct
- Check server logs for errors
- Ensure database files have write permissions

### Invitation not working
- Check invitation hasn't expired (7 days)
- Verify email matches exactly
- Check `data/invitations.json` for invitation status

## Future Enhancements

Potential improvements:
- Email delivery for invitations
- Password reset functionality
- Two-factor authentication
- OAuth integration (Google/Microsoft)
- Audit log of family changes
- Event sharing between families
