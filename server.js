const path = require('path');
const dotenv = require('dotenv');

// Load env files locally so POSTGRES_URL and other secrets are available outside Vercel
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.local') });

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Pool } = require('pg');
const fs = require('fs').promises;
const multer = require('multer');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const emailClient = require('./email');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'family-calendar-secret-change-in-production';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL;

const MAX_BACKGROUND_BYTES = 1.5 * 1024 * 1024;

// Trust proxy - CRITICAL for Vercel/serverless (behind reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '5mb' }));

// Session configuration - Set up immediately for serverless
let sessionMiddleware = null;
let currentSessionLabel = null;

const configureSessionMiddleware = (middleware, label) => {
    if (!middleware) {
        return false;
    }
    sessionMiddleware = middleware;
    currentSessionLabel = label;
    console.log(`[session] Using ${label} session store`);
    return true;
};

const createPostgresSessionMiddleware = () => {
    if (!POSTGRES_URL) {
        console.warn('[session] POSTGRES_URL not set; cannot enable Postgres session store.');
        return null;
    }

    const pool = new Pool({
        connectionString: POSTGRES_URL,
        ssl: POSTGRES_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
    });

    return session({
        store: new pgSession({
            pool,
            createTableIfMissing: true,
            tableName: 'sessions',
            schemaName: 'public'
        }),
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            secure: IS_PRODUCTION,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/'
        },
        name: 'connect.sid'
    });
};

const createDevelopmentSessionMiddleware = () => {
    const SQLiteStore = require('connect-sqlite3')(session);
    const store = new SQLiteStore({
        db: 'sessions.db',
        dir: './data'
    });

    return session({
        store,
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        },
        name: 'connect.sid'
    });
};

const createProductionFallbackSessionMiddleware = () => session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
    },
    name: 'connect.sid'
});

// Prefer Postgres-backed sessions in production
if (IS_PRODUCTION) {
    configureSessionMiddleware(createPostgresSessionMiddleware(), 'Postgres (Supabase)');
}

// Use SQLite when developing locally
if (!sessionMiddleware && !IS_PRODUCTION) {
    configureSessionMiddleware(createDevelopmentSessionMiddleware(), 'SQLite (development)');
}

// Final fallback: in-memory (not recommended for production)
if (!sessionMiddleware) {
    configureSessionMiddleware(createProductionFallbackSessionMiddleware(), 'in-memory fallback');
}

app.use((req, res, next) => sessionMiddleware(req, res, next));

const getInvitationFamilyId = (invitation, fallbackFamilyId = null) => {
    return invitation?.familyId || invitation?.family_id || fallbackFamilyId || null;
};

const getInvitationInvitedById = (invitation, fallbackInvitedBy = null) => {
    return invitation?.invitedById || invitation?.invitedBy || invitation?.invited_by || fallbackInvitedBy || null;
};

async function decorateInvitation(invitation) {
    if (!invitation) {
        return null;
    }

    const familyId = getInvitationFamilyId(invitation);
    const invitedById = getInvitationInvitedById(invitation);

    const [family, inviter] = await Promise.all([
        familyId ? db.getFamilyById(familyId) : Promise.resolve(null),
        invitedById ? db.getUserById(invitedById) : Promise.resolve(null)
    ]);

    return {
        ...invitation,
        familyId,
        familyName: family?.name || null,
        invitedBy: inviter?.name || inviter?.email || null,
        invitedById
    };
}


async function sendInvitationEmail(invitation, fallbackFamilyId, fallbackInviterId) {
    if (!emailClient.isEmailConfigured()) {
        return { sent: false, message: 'Gmail SMTP not configured.' };
    }

    try {
        const familyId = getInvitationFamilyId(invitation, fallbackFamilyId);
        const invitedById = getInvitationInvitedById(invitation, fallbackInviterId);

        const [family, inviter] = await Promise.all([
            familyId ? db.getFamilyById(familyId) : Promise.resolve(null),
            invitedById ? db.getUserById(invitedById) : Promise.resolve(null)
        ]);

        const familyName = family?.name || 'your family';
        const inviterName = inviter?.name || inviter?.email || 'Family Admin';
        const baseUrl = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '';
        const inviteLink = baseUrl
            ? `${baseUrl.replace(/\/$/, '')}/login.html?invite=${invitation.id}`
            : `Use the Family Calendar app and register with this email. Invitation ID: ${invitation.id}`;

        const subject = `Invitation to join ${familyName} on Family Calendar`;
        const text = [
            `Hi ${invitation.email},`,
            '',
            `${inviterName} invited you to join ${familyName} on Family Calendar.`,
            '',
            baseUrl
                ? `Open the link below to accept your invitation:\n${inviteLink}`
                : inviteLink,
            '',
            `You were invited with the role: ${invitation.role}.`,
            '',
            'If you did not expect this email, feel free to ignore it.',
            '',
            'Family Calendar'
        ].join('\n');

        return await emailClient.sendEmail({
            to: invitation.email,
            subject,
            text
        });
    } catch (error) {
        console.error('[invite] Failed to send invitation email:', error);
        return {
            sent: false,
            message: error?.message || 'Failed to send invitation email'
        };
    }
}



if (!SESSION_SECRET || SESSION_SECRET === 'family-calendar-secret-change-in-production') {
    console.warn('WARNING: Using default SESSION_SECRET. Set SESSION_SECRET environment variable for production!');
}

// Optional: Light request logging (can be removed in production)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        console.log(`${req.method} ${req.path}`, {
            hasSession: !!req.session,
            sessionID: req.sessionID,
            userId: req.session?.userId,
            userRole: req.session?.userRole,
            familyId: req.session?.familyId,
            hasCookie: !!req.headers.cookie,
            cookieHeader: req.headers.cookie?.substring(0, 100) + '...',
            fullSession: req.session
        });
    }
    next();
});

// Don't initialize yet - will do it before server starts
app.use(express.static(path.join(__dirname)));

// Configure multer for file uploads
// Use /tmp on Vercel (only writable directory), uploads/ locally
const upload = multer({
    dest: IS_PRODUCTION ? '/tmp' : 'uploads/',
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.ics', '.csv'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext));
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: {
            isProduction: IS_PRODUCTION,
            hasSessionSecret: !!SESSION_SECRET,
            hasPostgresUrl: Boolean(POSTGRES_URL),
            sessionStore: currentSessionLabel
        }
    });
});

// Debug endpoint to check events in database
app.get('/api/debug/events', requireAuth, async (req, res) => {
    try {
        const events = await db.getEventsByFamily(req.session.familyId, req.session.userId);
        res.json({
            familyId: req.session.familyId,
            userId: req.session.userId,
            eventCount: events.length,
            events: events
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ensure data directory exists (for local development only - not needed in production)
async function ensureDataDir() {
    // Skip in production (Vercel) - we use Postgres, not file storage
    if (IS_PRODUCTION) {
        return;
    }

    try {
        await fs.access(path.join(__dirname, 'data'));
    } catch {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    }
}

// Authentication API Routes

// Initialize database (admin endpoint)
app.get('/api/init-db', async (req, res) => {
    try {
        console.log('Manual DB initialization requested...');
        await db.initializeDB();
        res.json({ success: true, message: 'Database initialized successfully' });
    } catch (error) {
        console.error('DB init error:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// Register new user (first user creates family)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }

        // Check if this is the first user (family creator)
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Create family for first user
        const family = await db.createFamily({
            name: `${name}'s Family`,
            createdBy: email
        });

        // Create user with admin role (first user is admin)
        const user = await db.createUser({
            email,
            password,
            name,
            role: 'admin',
            familyId: family.id
        });

        // Set session (if available)
        if (req.session) {
            req.session.userId = user.id;
            req.session.userRole = user.role;
            req.session.familyId = user.familyId;

            // Explicitly save session before responding
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        res.status(201).json({ user, family });
    } catch (error) {
        console.error('Registration error:', error);
        console.error('Error stack:', error.stack);
        console.error('Error code:', error.code);
        res.status(500).json({
            error: error.message || 'Registration failed',
            code: error.code
        });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await db.verifyPassword(email, password);

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Set session
        if (req.session) {
            console.log('Before setting session - sessionID:', req.sessionID);
            req.session.userId = user.id;
            req.session.userRole = user.role;
            req.session.familyId = user.familyId || user.family_id;

            console.log('After setting session data:', {
                sessionID: req.sessionID,
                userId: req.session.userId,
                userRole: req.session.userRole
            });

            // Explicitly save session before responding
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) {
                        console.error('Session save error:', err);
                        reject(err);
                    } else {
                        console.log('✅ Session saved successfully', {
                            sessionID: req.sessionID,
                            userId: req.session.userId,
                            userRole: req.session.userRole,
                            familyId: req.session.familyId,
                            fullSession: req.session
                        });
                        resolve();
                    }
                });
            });
        } else {
            console.warn('⚠️  Session not available during login');
        }

        const family = await db.getFamilyById(user.familyId || user.family_id);
        res.json({ user, family });
    } catch (error) {
        console.error('Login error:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

// Get current user
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await db.getUserById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password, ...userWithoutPassword } = user;
        const familyId = user.familyId || user.family_id || req.session.familyId;
        const family = familyId ? await db.getFamilyById(familyId) : null;

        const responseUser = {
            ...userWithoutPassword,
            familyId
        };

        res.json({ user: responseUser, family });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Family Management Routes

// Get family members
app.get('/api/family/members', requireAuth, async (req, res) => {
    try {
        const members = await db.getFamilyMembers(req.session.familyId);
        res.json(members);
    } catch (error) {
        console.error('Get family members error:', error);
        res.status(500).json({ error: 'Failed to get family members' });
    }
});

// Invite family member (admin only)
app.post('/api/family/invite', requireRole('admin'), async (req, res) => {
    try {
        const { email, role } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        console.log('[invite] Admin request', {
            invitedBy: req.session.userId,
            familyId: req.session.familyId,
            email,
            role: role || 'adult'
        });

        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser && (existingUser.family_id === req.session.familyId || existingUser.familyId === req.session.familyId)) {
            return res.status(400).json({ error: 'User is already a member of this family' });
        }

        const invitation = await db.createInvitation({
            email,
            familyId: req.session.familyId,
            invitedBy: req.session.userId,
            role: role || 'adult'
        });

        console.log('[invite] Invitation created', {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt
        });

        const emailResult = await sendInvitationEmail(invitation, req.session.familyId, req.session.userId);

        if (!emailResult.sent) {
            console.log('[invite] Invitation email not sent:', emailResult.message);
        }

        const invitationResponse = await decorateInvitation(invitation);

        res.status(201).json({
            invitation: invitationResponse,
            emailSent: emailResult.sent,
            emailMessage: emailResult.message
        });
    } catch (error) {
        console.error('Invitation error:', error);
        res.status(500).json({ error: error.message || 'Failed to create invitation' });
    }
});

// Get pending invitations for current family (admin only)
app.get('/api/family/invitations', requireRole('admin'), async (req, res) => {
    try {
        const invitations = await db.getFamilyInvitations(req.session.familyId);
        const decorated = await Promise.all(invitations.map(decorateInvitation));
        res.json(decorated);
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to get invitations' });
    }
});

app.delete('/api/family/invitations/:id', requireRole('admin'), async (req, res) => {
    try {
        const invitationId = req.params.id;
        const invitation = await db.getInvitationById(invitationId);
        if (!invitation || invitation.family_id !== req.session.familyId) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ error: 'Cannot cancel an accepted invitation' });
        }

        const cancelled = await db.cancelInvitation(invitationId, req.session.familyId);

        if (!cancelled) {
            return res.status(404).json({ error: 'Invitation not found or already cancelled' });
        }

        console.log('[invite] Invitation cancelled', {
            invitationId,
            cancelledBy: req.session.userId
        });

        const invitationResponse = await decorateInvitation(cancelled);

        res.json({ invitation: invitationResponse });
    } catch (error) {
        console.error('Cancel invitation error:', error);
        res.status(500).json({ error: 'Failed to cancel invitation' });
    }
});

app.post('/api/family/invitations/:id/resend', requireRole('admin'), async (req, res) => {
    try {
        const invitationId = req.params.id;
        const invitation = await db.getInvitationById(invitationId);
        if (!invitation || invitation.family_id !== req.session.familyId) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ error: 'Cannot resend an accepted invitation' });
        }

        const updatedInvitation = await db.resendInvitation(invitationId, req.session.familyId, req.session.userId);

        if (!updatedInvitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        console.log('[invite] Invitation resend requested', {
            invitationId,
            requestedBy: req.session.userId
        });

        const emailResult = await sendInvitationEmail(updatedInvitation, req.session.familyId, req.session.userId);

        if (!emailResult.sent) {
            console.log('[invite] Invitation resend email not sent:', emailResult.message);
        }

        const invitationResponse = await decorateInvitation(updatedInvitation);

        res.json({
            invitation: invitationResponse,
            emailSent: emailResult.sent,
            emailMessage: emailResult.message
        });
    } catch (error) {
        console.error('Resend invitation error:', error);
        res.status(500).json({ error: 'Failed to resend invitation' });
    }
});

// Admin session log
app.get('/api/admin/sessions', requireRole('admin'), async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
        const sessions = await db.getActiveSessions({
            limit,
            familyId: req.session.familyId
        });
        res.json({
            limit,
            count: sessions.length,
            sessions
        });
    } catch (error) {
        console.error('Session log error:', error);
        res.status(500).json({ error: 'Failed to load session log' });
    }
});

// Test email trigger (logs message, no actual email is sent without SMTP integration)
app.post('/api/admin/test-email', requireRole('admin'), async (req, res) => {
    try {
        const targetEmail = req.body?.email || req.body?.targetEmail;
        let fallbackEmail = null;
        if (!targetEmail && req.session?.userId) {
            const requester = await db.getUserById(req.session.userId);
            fallbackEmail = requester?.email;
        }

        const destination = targetEmail || fallbackEmail || process.env.GMAIL_TEST_EMAIL || process.env.GMAIL_USER || 'admin@example.com';
        const subject = 'Family Calendar Test Email';
        const timestamp = new Date().toISOString();
        const text = [
            'Hello from Family Calendar!',
            '',
            `This is a test email generated at ${timestamp}.`,
            '',
            'If you received this email, Gmail SMTP delivery is working correctly.',
            '',
            '— Family Calendar'
        ].join('\n');

        const emailResult = await emailClient.sendEmail({
            to: destination,
            subject,
            text
        });

        res.json({
            success: emailResult.sent,
            message: emailResult.message,
            targetEmail: destination,
            emailConfigured: emailClient.isEmailConfigured()
        });
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ error: 'Failed to generate test email' });
    }
});

// Get invitations for email (for registration page)
app.get('/api/invitations/:email', async (req, res) => {
    try {
        const invitations = await db.getInvitationsByEmail(req.params.email);
        const decorated = await Promise.all(invitations.map(decorateInvitation));
        res.json(decorated);
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to get invitations' });
    }
});

// Accept invitation and register
app.post('/api/invitations/:id/accept', async (req, res) => {
    try {
        const { password, name } = req.body;
        const invitationId = req.params.id;

        if (!password || !name) {
            return res.status(400).json({ error: 'Name and password are required' });
        }

        const invitation = await db.getInvitationById(invitationId);

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ error: 'Invitation already processed' });
        }

        const expiresAt = invitation.expiresAt || invitation.expires_at;
        if (expiresAt && new Date(expiresAt) < new Date()) {
            return res.status(400).json({ error: 'Invitation has expired' });
        }

        const familyId = getInvitationFamilyId(invitation);
        if (!familyId) {
            return res.status(400).json({ error: 'Invitation is missing family information' });
        }

        let user = await db.getUserByEmail(invitation.email);
        if (user) {
            user = await db.updateUserForInvitation(user.id, {
                password,
                name,
                role: invitation.role,
                familyId
            });
        } else {
            user = await db.createUser({
                email: invitation.email,
                password,
                name,
                role: invitation.role,
                familyId
            });
        }

        await db.updateInvitationStatus(invitationId, 'accepted');

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.familyId = familyId;

        const family = await db.getFamilyById(familyId);

        res.status(201).json({ user, family });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ error: error.message || 'Failed to accept invitation' });
    }
});

// Update user role (admin only)
app.put('/api/family/members/:id/role', requireRole('admin'), async (req, res) => {
    try {
        const { role } = req.body;
        const userId = req.params.id;

        if (!['admin', 'adult', 'child'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const user = await db.getUserById(userId);

        if (!user || user.familyId !== req.session.familyId) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Don't allow changing own role
        if (userId === req.session.userId) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        const updatedUser = await db.updateUser(userId, { role });

        res.json(updatedUser);
    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// Remove family member (admin only)
app.delete('/api/family/members/:id', requireRole('admin'), async (req, res) => {
    try {
        const userId = req.params.id;

        const user = await db.getUserById(userId);

        if (!user || user.familyId !== req.session.familyId) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Don't allow deleting own account
        if (userId === req.session.userId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        await db.deleteUser(userId);

        res.json({ message: 'User removed successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Failed to remove user' });
    }
});

// Event API Routes (Protected)

// Get all events for family
app.get('/api/events', requireAuth, async (req, res) => {
    try {
        console.log('Loading events for family:', req.session.familyId, 'user:', req.session.userId);
        const events = await db.getEventsByFamily(req.session.familyId, req.session.userId);
        console.log('Loaded events:', events.length, 'events');
        res.json(events);
    } catch (error) {
        console.error('Error loading events:', error);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

// Get events for a specific month
app.get('/api/events/:year/:month', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const events = await db.getEventsByMonth(parseInt(year), parseInt(month), req.session.familyId, req.session.userId);
        res.json(events);
    } catch (error) {
        console.error('Error loading monthly events:', error);
        res.status(500).json({ error: 'Failed to load monthly events' });
    }
});

// Load all events (legacy endpoint for backward compatibility)
app.get('/api/events/monthly/all', requireAuth, async (req, res) => {
    try {
        const events = await db.getEventsByFamily(req.session.familyId, req.session.userId);
        res.json(events);
    } catch (error) {
        console.error('Error loading events:', error);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

// Add new event
app.post('/api/events', requireAuth, async (req, res) => {
    try {
        console.log('Creating event:', {
            body: req.body,
            userId: req.session.userId,
            familyId: req.session.familyId
        });

        const newEvent = await db.createEvent({
            ...req.body,
            ownerId: req.session.userId,
            familyId: req.session.familyId,
            visibility: req.body.visibility || 'shared'
        });

        console.log('Event created:', newEvent);
        res.status(201).json(newEvent);
    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).json({ error: 'Failed to add event' });
    }
});

// Update event
app.put('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const event = await db.getEventById(req.params.id);

        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Authorization: only owner or admin can edit
        if (event.owner_id !== req.session.userId && req.session.userRole !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to edit this event' });
        }

        // Children cannot change visibility or owner
        const updates = { ...req.body };
        if (req.session.userRole === 'child') {
            delete updates.visibility;
            delete updates.ownerId;
            delete updates.familyId;
        }

        const updatedEvent = await db.updateEvent(req.params.id, updates);
        res.json(updatedEvent);
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// Delete event
app.delete('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const event = await db.getEventById(req.params.id);

        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Authorization: only owner or admin can delete
        if (event.owner_id !== req.session.userId && req.session.userRole !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to delete this event' });
        }

        const deletedEvent = await db.deleteEvent(req.params.id);
        res.json(deletedEvent);
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// Day background routes
app.get('/api/day-backgrounds', requireAuth, async (req, res) => {
    try {
        const backgrounds = await db.getDayBackgroundsByFamily(req.session.familyId);
        res.json({ backgrounds });
    } catch (error) {
        console.error('Error loading day backgrounds:', error);
        res.status(500).json({ error: 'Failed to load backgrounds' });
    }
});

app.post('/api/day-backgrounds', requireAuth, async (req, res) => {
    try {
        const { date, imageData } = req.body || {};
        if (!date || !imageData) {
            return res.status(400).json({ error: 'Date and imageData are required' });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        if (typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Invalid image data' });
        }

        const commaIndex = imageData.indexOf(',');
        if (commaIndex === -1) {
            return res.status(400).json({ error: 'Malformed data URL' });
        }

        const base64 = imageData.substring(commaIndex + 1);
        let sizeInBytes = 0;
        try {
            sizeInBytes = Buffer.from(base64, 'base64').length;
        } catch (err) {
            return res.status(400).json({ error: 'Invalid image encoding' });
        }

        if (sizeInBytes > MAX_BACKGROUND_BYTES) {
            return res.status(400).json({ error: 'Image exceeds 1.5 MB size limit' });
        }

        const background = await db.setDayBackground(req.session.familyId, date, imageData, req.session.userId);
        res.json({ background });
    } catch (error) {
        console.error('Error saving day background:', error);
        res.status(500).json({ error: 'Failed to save background' });
    }
});

app.delete('/api/day-backgrounds/:date', requireAuth, async (req, res) => {
    try {
        const { date } = req.params;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        await db.deleteDayBackground(req.session.familyId, date);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing day background:', error);
        res.status(500).json({ error: 'Failed to remove background' });
    }
});

// Upload and parse calendar file
app.post('/api/import', requireAuth, upload.single('calendarFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const fileContent = await fs.readFile(filePath, 'utf8');

        let importedEvents = [];

        if (req.file.originalname.endsWith('.ics')) {
            importedEvents = parseICSFile(fileContent);
        } else if (req.file.originalname.endsWith('.csv')) {
            importedEvents = parseCSVFile(fileContent);
        }

        // Add owner and family info to imported events
        importedEvents = importedEvents.map(event => ({
            ...event,
            ownerId: req.session.userId,
            familyId: req.session.familyId,
            visibility: 'shared'
        }));

        // Bulk create events in database, skipping duplicates
        const { created, skipped } = await db.bulkCreateEvents(importedEvents);

        // Clean up uploaded file
        await fs.unlink(filePath);

        const duplicateNote = skipped > 0
            ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)`
            : '';

        res.json({
            message: `Imported ${created.length} event${created.length === 1 ? '' : 's'} successfully${duplicateNote}`,
            importedCount: created.length,
            skippedCount: skipped
        });
    } catch (error) {
        console.error('Error importing events:', error);
        res.status(500).json({ error: 'Failed to import events' });
    }
});

// Helper functions for parsing files
function parseICSFile(content) {
    const events = [];
    const lines = content.split('\n');
    let currentEvent = null;
    
    for (let line of lines) {
        line = line.trim();
        
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (line === 'END:VEVENT' && currentEvent) {
            if (currentEvent.title && currentEvent.date) {
                const detectedEmoji = detectEmojiFromTitle(currentEvent.title);
                events.push({
                    id: 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                    title: currentEvent.title,
                    date: currentEvent.date,
                    time: currentEvent.time || '',
                    description: currentEvent.description || '',
                    color: 'blue',
                    emoji: detectedEmoji,
                    createdAt: new Date().toISOString()
                });
            }
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith('SUMMARY:')) {
                currentEvent.title = line.substring(8);
            } else if (line.startsWith('DTSTART')) {
                const dateMatch = line.match(/(\d{8})/);
                if (dateMatch) {
                    const dateStr = dateMatch[1];
                    const year = dateStr.substring(0, 4);
                    const month = dateStr.substring(4, 6);
                    const day = dateStr.substring(6, 8);
                    currentEvent.date = `${year}-${month}-${day}`;
                }
                
                const timeMatch = line.match(/T(\d{6})/);
                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    const hour = timeStr.substring(0, 2);
                    const minute = timeStr.substring(2, 4);
                    currentEvent.time = `${hour}:${minute}`;
                }
            } else if (line.startsWith('DESCRIPTION:')) {
                currentEvent.description = line.substring(12);
            }
        }
    }
    
    return events;
}

function parseCSVFile(content) {
    const lines = content.split('\n');
    const events = [];
    
    const startIndex = lines[0].toLowerCase().includes('title') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = parseCSVLine(line);
        if (columns.length >= 2) {
            const title = columns[0];
            const date = parseDate(columns[1]);
            const time = columns.length > 2 ? columns[2] : '';
            const description = columns.length > 3 ? columns[3] : '';
            
            if (title && date) {
                const detectedEmoji = detectEmojiFromTitle(title);
                events.push({
                    id: 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                    title: title,
                    date: date,
                    time: time,
                    description: description,
                    color: 'blue',
                    emoji: detectedEmoji,
                    createdAt: new Date().toISOString()
                });
            }
        }
    }
    
    return events;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result.map(field => field.replace(/^"(.*)"$/, '$1'));
}

function parseDate(dateString) {
    const formats = [
        /^(\d{4})-(\d{2})-(\d{2})$/,
        /^(\d{2})\/(\d{2})\/(\d{4})$/,
        /^(\d{2})\/(\d{2})\/(\d{2})$/,
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    ];
    
    for (let format of formats) {
        const match = dateString.match(format);
        if (match) {
            let year, month, day;
            
            if (format.source.startsWith('^(\\d{4})')) {
                year = match[1];
                month = match[2];
                day = match[3];
            } else {
                month = match[1].padStart(2, '0');
                day = match[2].padStart(2, '0');
                year = match[3];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
            }
            
            return `${year}-${month}-${day}`;
        }
    }
    
    return null;
}

function detectEmojiFromTitle(title) {
    if (!title) return '';
    
    const titleLower = title.toLowerCase();
    
    // Sports emojis
    if (titleLower.includes('football')) return '🏈';
    if (titleLower.includes('basketball')) return '🏀';
    if (titleLower.includes('soccer')) return '⚽';
    
    // Celebration emojis
    if (titleLower.includes('birthday')) return '🎂';
    if (titleLower.includes('party')) return '🎉';
    if (titleLower.includes('celebration')) return '🥳';
    if (titleLower.includes('anniversary')) return '❤️';
    
    // Work/School emojis
    if (titleLower.includes('meeting')) return '💼';
    if (titleLower.includes('work')) return '💻';
    if (titleLower.includes('school')) return '📚';
    if (titleLower.includes('class')) return '📖';
    if (titleLower.includes('exam') || titleLower.includes('test')) return '✏️';
    if (titleLower.includes('presentation')) return '📊';
    if (titleLower.includes('graduation')) return '🎓';
    
    // Health/Medical emojis
    if (titleLower.includes('doctor') || titleLower.includes('appointment')) return '🏥';
    if (titleLower.includes('dentist')) return '🏥';
    if (titleLower.includes('medicine') || titleLower.includes('pill')) return '💊';
    if (titleLower.includes('workout') || titleLower.includes('gym')) return '🏋️';
    if (titleLower.includes('yoga') || titleLower.includes('meditation')) return '🧘';
    
    // Food/Dining emojis
    if (titleLower.includes('lunch') || titleLower.includes('dinner') || titleLower.includes('breakfast')) return '🍕';
    if (titleLower.includes('coffee')) return '☕';
    if (titleLower.includes('cake') || titleLower.includes('dessert')) return '🍰';
    
    // Travel emojis
    if (titleLower.includes('flight') || titleLower.includes('airplane')) return '✈️';
    if (titleLower.includes('drive') || titleLower.includes('car')) return '🚗';
    if (titleLower.includes('vacation') || titleLower.includes('holiday')) return '🏖️';
    if (titleLower.includes('trip') || titleLower.includes('travel')) return '🗺️';
    if (titleLower.includes('beach')) return '⛱️';
    
    // Entertainment emojis
    if (titleLower.includes('music') || titleLower.includes('concert')) return '🎵';
    if (titleLower.includes('movie') || titleLower.includes('film')) return '🎪';
    if (titleLower.includes('game') || titleLower.includes('gaming')) return '🎮';
    if (titleLower.includes('art') || titleLower.includes('paint')) return '🎨';
    if (titleLower.includes('reading') || titleLower.includes('book')) return '📚';
    
    // Activity emojis
    if (titleLower.includes('run') || titleLower.includes('running')) return '🏃';
    if (titleLower.includes('walk') || titleLower.includes('walking')) return '🏃';
    
    // Default - no emoji
    return '';
}

// Serve static files explicitly (Vercel serverless needs explicit routes)
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

app.get('/script-server.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'script-server.js'));
});

app.get('/script.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});

// Serve HTML files explicitly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server after initializing database
async function startServer() {
    try {
        console.log('🚀 Starting Family Calendar server...');
        console.log('Environment:', process.env.NODE_ENV || 'development');
        console.log('Has POSTGRES_URL:', !!process.env.POSTGRES_URL);
        console.log('Session store:', currentSessionLabel || 'unknown');

        // Initialize database (don't fail if it errors - tables might exist)
        console.log('🗄️  Initializing database...');
        try {
            await db.initializeDB();
            console.log('✅ Database initialized');
        } catch (dbErr) {
            console.error('⚠️  Database init warning (may be okay if tables exist):', dbErr.message);
        }

        // Start listening (only for local dev, Vercel uses module.exports)
        if (!IS_PRODUCTION) {
            app.listen(PORT, () => {
                console.log(`✅ Family Calendar server running on port ${PORT}`);
            });
        }
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        console.error('Stack:', err.stack);
        // Don't exit in production - let Vercel handle restart
        if (!IS_PRODUCTION) {
            process.exit(1);
        }
    }
}

// For Vercel serverless, export immediately without async init
if (IS_PRODUCTION) {
    console.log('🚀 Vercel serverless mode - exporting app');
    // Initialize database in background (don't wait)
    db.initializeDB().catch(err => {
        console.error('⚠️  Database init warning (may be okay if tables exist):', err.message);
    });
    module.exports = app;
} else {
    // Start normally for local development
    startServer();
}



