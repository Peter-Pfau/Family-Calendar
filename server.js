const express = require('express');
const cors = require('cors');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'family-calendar-secret-change-in-production';
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL; // Support both Upstash and Vercel KV
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL;

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

// Session configuration - Set up immediately for serverless
if (REDIS_URL) {
    // Production: Use Redis (Vercel, Upstash, etc.)
    console.log('🔴 Setting up Redis session store');
    const RedisStore = require('connect-redis').default;
    const { createClient } = require('redis');

    const redisClient = createClient({
        url: REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
            tls: REDIS_URL.startsWith('rediss://'),
            rejectUnauthorized: false // Accept self-signed certificates (Upstash)
        }
    });

    redisClient.on('error', (err) => console.error('Redis Client Error', err));
    redisClient.on('connect', () => console.log('✅ Redis connected'));

    // Connect asynchronously but don't block
    redisClient.connect().catch(err => console.error('Redis connection error:', err));

    const store = new RedisStore({ client: redisClient });

    app.use(session({
        store: store,
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: IS_PRODUCTION,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: IS_PRODUCTION ? 'none' : 'lax'
        }
    }));
} else {
    // Development: Use SQLite
    console.log('💾 Setting up SQLite session store');
    const SQLiteStore = require('connect-sqlite3')(session);
    const store = new SQLiteStore({
        db: 'sessions.db',
        dir: './data'
    });

    app.use(session({
        store: store,
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        }
    }));
}

if (!SESSION_SECRET || SESSION_SECRET === 'family-calendar-secret-change-in-production') {
    console.warn('⚠️  WARNING: Using default SESSION_SECRET. Set SESSION_SECRET environment variable for production!');
}

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

        // Set session (if available)
        if (req.session) {
            req.session.userId = user.id;
            req.session.userRole = user.role;
            req.session.familyId = user.familyId || user.family_id;

            // Explicitly save session before responding
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
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
        const family = await db.getFamilyById(user.familyId);

        res.json({ user: userWithoutPassword, family });
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

        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const invitation = await db.createInvitation({
            email,
            familyId: req.session.familyId,
            invitedBy: req.session.userId,
            role: role || 'adult'
        });

        res.status(201).json(invitation);
    } catch (error) {
        console.error('Invitation error:', error);
        res.status(500).json({ error: error.message || 'Failed to create invitation' });
    }
});

// Get pending invitations for current family (admin only)
app.get('/api/family/invitations', requireRole('admin'), async (req, res) => {
    try {
        const invitations = await db.getFamilyInvitations(req.session.familyId);
        res.json(invitations);
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to get invitations' });
    }
});

// Get invitations for email (for registration page)
app.get('/api/invitations/:email', async (req, res) => {
    try {
        const invitations = await db.getInvitationsByEmail(req.params.email);
        res.json(invitations);
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

        // Check if invitation has expired
        if (new Date(invitation.expiresAt) < new Date()) {
            return res.status(400).json({ error: 'Invitation has expired' });
        }

        // Create user
        const user = await db.createUser({
            email: invitation.email,
            password,
            name,
            role: invitation.role,
            familyId: invitation.familyId
        });

        // Update invitation status
        await db.updateInvitationStatus(invitationId, 'accepted');

        // Set session
        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.familyId = user.familyId;

        const family = await db.getFamilyById(user.familyId);

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
        const events = await db.getEventsByFamily(req.session.familyId, req.session.userId);
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
        const newEvent = await db.createEvent({
            ...req.body,
            ownerId: req.session.userId,
            familyId: req.session.familyId,
            visibility: req.body.visibility || 'shared'
        });
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

        // Bulk create events in database
        await db.bulkCreateEvents(importedEvents);

        // Clean up uploaded file
        await fs.unlink(filePath);

        res.json({
            message: `Imported ${importedEvents.length} events successfully`,
            importedCount: importedEvents.length
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
        console.log('Has REDIS_URL:', !!process.env.REDIS_URL);

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

// For Vercel serverless, initialize and export
if (IS_PRODUCTION) {
    // Initialize immediately (synchronously set up session store)
    (async () => {
        try {
            await startServer();
        } catch (err) {
            console.error('Startup error:', err);
        }
    })();
    module.exports = app;
} else {
    // Start normally for local development
    startServer();
}