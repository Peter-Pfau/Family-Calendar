const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Disable Node.js SSL certificate validation for self-signed certs (Supabase, etc.)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Create connection pool with error handling
let pool;
try {
    pool = new Pool({
        connectionString: process.env.POSTGRES_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
    });
} catch (error) {
    console.error('Failed to create database pool:', error);
    throw error;
}

// Helper function to execute queries
async function query(text, params) {
    const result = await pool.query(text, params);
    return result;
}

// Initialize database tables
async function initializeDB() {
    try {
        // Create families table
        await query(`
            CREATE TABLE IF NOT EXISTS families (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create users table
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'adult', 'child')),
                family_id VARCHAR(255) REFERENCES families(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        `);

        await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id)`);

        // Create invitations table
        await query(`
            CREATE TABLE IF NOT EXISTS invitations (
                id VARCHAR(255) PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                family_id VARCHAR(255) REFERENCES families(id) ON DELETE CASCADE,
                invited_by VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'adult', 'child')),
                status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        await query(`CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_invitations_family ON invitations(family_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status)`);

        // Create events table
        await query(`
            CREATE TABLE IF NOT EXISTS events (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                date DATE NOT NULL,
                time VARCHAR(10),
                description TEXT,
                color VARCHAR(50) DEFAULT 'blue',
                emoji VARCHAR(10),
                owner_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
                family_id VARCHAR(255) REFERENCES families(id) ON DELETE CASCADE,
                visibility VARCHAR(50) NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private')),
                recurrence_type VARCHAR(50),
                recurrence_interval INTEGER DEFAULT 1,
                recurrence_until DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        `);

        await query(`CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility)`);

        // Ensure recurrence columns exist for older deployments
        await query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_type VARCHAR(50)`);
        await query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1`);
        await query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_until DATE`);
        await query(`ALTER TABLE events ALTER COLUMN recurrence_interval SET DEFAULT 1`);

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

// User operations
async function createUser(userData) {
    // Check if user already exists
    const existingUser = await getUserByEmail(userData.email);
    if (existingUser) {
        throw new Error('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    const id = 'user_' + Math.random().toString(36).substring(2) + Date.now().toString(36);

    await query(
        'INSERT INTO users (id, email, name, password, role, family_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
        [id, userData.email, userData.name, hashedPassword, userData.role || 'adult', userData.familyId]
    );

    const user = await getUserById(id);
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

async function getUserByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    return result.rows[0] || null;
}

async function getUserById(id) {
    const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function updateUser(id, updates) {
    const user = await getUserById(id);
    if (!user) {
        throw new Error('User not found');
    }

    // Build dynamic update query (exclude email and password)
    const { email, password, ...safeUpdates } = updates;

    if (safeUpdates.role) {
        await query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [safeUpdates.role, id]);
    }

    if (safeUpdates.name) {
        await query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [safeUpdates.name, id]);
    }

    const updatedUser = await getUserById(id);
    const { password: _, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
}

async function deleteUser(id) {
    const user = await getUserById(id);
    if (!user) {
        throw new Error('User not found');
    }

    await query('DELETE FROM users WHERE id = $1', [id]);
}

async function verifyPassword(email, password) {
    const user = await getUserByEmail(email);
    if (!user) {
        return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        return null;
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

// Family operations
async function createFamily(familyData) {
    const id = 'family_' + Math.random().toString(36).substring(2) + Date.now().toString(36);

    await query(
        'INSERT INTO families (id, name, created_by, created_at) VALUES ($1, $2, $3, NOW())',
        [id, familyData.name, familyData.createdBy]
    );

    return await getFamilyById(id);
}

async function getFamilyById(id) {
    const result = await query('SELECT * FROM families WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function getFamilyMembers(familyId) {
    const result = await query(
        'SELECT id, email, name, role, family_id, created_at, updated_at FROM users WHERE family_id = $1 ORDER BY created_at ASC',
        [familyId]
    );
    return result.rows;
}

// Invitation operations
async function createInvitation(invitationData) {
    // Check if invitation already exists
    const existing = await query(
        'SELECT * FROM invitations WHERE email = $1 AND family_id = $2 AND status = $3 LIMIT 1',
        [invitationData.email, invitationData.familyId, 'pending']
    );

    if (existing.rows.length > 0) {
        throw new Error('Invitation already sent to this email');
    }

    const id = 'invite_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await query(
        'INSERT INTO invitations (id, email, family_id, invited_by, role, status, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)',
        [id, invitationData.email, invitationData.familyId, invitationData.invitedBy, invitationData.role || 'adult', 'pending', expiresAt.toISOString()]
    );

    return await getInvitationById(id);
}

async function getInvitationById(id) {
    const result = await query('SELECT * FROM invitations WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function getInvitationsByEmail(email) {
    const result = await query(
        'SELECT * FROM invitations WHERE email = $1 AND status = $2 ORDER BY created_at DESC',
        [email, 'pending']
    );
    return result.rows;
}

async function updateInvitationStatus(id, status) {
    await query('UPDATE invitations SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
    return await getInvitationById(id);
}

async function getFamilyInvitations(familyId) {
    const result = await query(
        'SELECT * FROM invitations WHERE family_id = $1 ORDER BY created_at DESC',
        [familyId]
    );
    return result.rows;
}

// Event operations
async function createEvent(eventData) {
    const id = 'event_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const recurrenceType = eventData.recurrenceType || null;
    const recurrenceInterval = recurrenceType ? (eventData.recurrenceInterval || 1) : null;
    const recurrenceUntil = eventData.recurrenceUntil || null;

    await query(
        `INSERT INTO events (
            id, title, date, time, description, color, emoji, owner_id, family_id, visibility,
            recurrence_type, recurrence_interval, recurrence_until, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
            id,
            eventData.title,
            eventData.date,
            eventData.time || '',
            eventData.description || '',
            eventData.color || 'blue',
            eventData.emoji || '',
            eventData.ownerId,
            eventData.familyId,
            eventData.visibility || 'shared',
            recurrenceType,
            recurrenceInterval,
            recurrenceUntil
        ]
    );

    return await getEventById(id);
}

async function getEventById(id) {
    const result = await query(
        `SELECT 
            id,
            title,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            time,
            description,
            color,
            emoji,
            owner_id,
            family_id,
            visibility,
            recurrence_type AS "recurrenceType",
            recurrence_interval AS "recurrenceInterval",
            TO_CHAR(recurrence_until, 'YYYY-MM-DD') AS "recurrenceUntil",
            created_at,
            updated_at
        FROM events
        WHERE id = $1
        LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
}

async function getEventsByFamily(familyId, userId) {
    // Get shared events for the family and private events for the user
    const result = await query(
        `SELECT
            id,
            title,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            time,
            description,
            color,
            emoji,
            owner_id,
            family_id,
            visibility,
            recurrence_type AS "recurrenceType",
            recurrence_interval AS "recurrenceInterval",
            TO_CHAR(recurrence_until, 'YYYY-MM-DD') AS "recurrenceUntil",
            created_at,
            updated_at
        FROM events
        WHERE (family_id = $1 AND visibility = $2) OR (owner_id = $3 AND visibility = $4)
        ORDER BY date ASC`,
        [familyId, 'shared', userId, 'private']
    );
    return result.rows;
}

async function getEventsByMonth(year, month, familyId, userId) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    const result = await query(
        `SELECT
            id,
            title,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            time,
            description,
            color,
            emoji,
            owner_id,
            family_id,
            visibility,
            recurrence_type AS "recurrenceType",
            recurrence_interval AS "recurrenceInterval",
            TO_CHAR(recurrence_until, 'YYYY-MM-DD') AS "recurrenceUntil",
            created_at,
            updated_at
        FROM events
        WHERE date >= $1 AND date <= $2
          AND ((family_id = $3 AND visibility = $4) OR (owner_id = $5 AND visibility = $6))
        ORDER BY date ASC`,
        [startDate, endDate, familyId, 'shared', userId, 'private']
    );
    return result.rows;
}

async function updateEvent(id, updates) {
    const event = await getEventById(id);
    if (!event) {
        throw new Error('Event not found');
    }

    // Update fields that are provided
    if (updates.title !== undefined) {
        await query('UPDATE events SET title = $1, updated_at = NOW() WHERE id = $2', [updates.title, id]);
    }
    if (updates.date !== undefined) {
        await query('UPDATE events SET date = $1, updated_at = NOW() WHERE id = $2', [updates.date, id]);
    }
    if (updates.time !== undefined) {
        await query('UPDATE events SET time = $1, updated_at = NOW() WHERE id = $2', [updates.time, id]);
    }
    if (updates.description !== undefined) {
        await query('UPDATE events SET description = $1, updated_at = NOW() WHERE id = $2', [updates.description, id]);
    }
    if (updates.color !== undefined) {
        await query('UPDATE events SET color = $1, updated_at = NOW() WHERE id = $2', [updates.color, id]);
    }
    if (updates.emoji !== undefined) {
        await query('UPDATE events SET emoji = $1, updated_at = NOW() WHERE id = $2', [updates.emoji, id]);
    }
    if (updates.visibility !== undefined) {
        await query('UPDATE events SET visibility = $1, updated_at = NOW() WHERE id = $2', [updates.visibility, id]);
    }
    if (updates.recurrenceType !== undefined) {
        const recurrenceType = updates.recurrenceType || null;
        await query('UPDATE events SET recurrence_type = $1, updated_at = NOW() WHERE id = $2', [recurrenceType, id]);

        if (!recurrenceType) {
            await query('UPDATE events SET recurrence_interval = NULL, recurrence_until = NULL, updated_at = NOW() WHERE id = $1', [id]);
        }
    }
    if (updates.recurrenceInterval !== undefined) {
        const recurrenceInterval = updates.recurrenceInterval || null;
        await query('UPDATE events SET recurrence_interval = $1, updated_at = NOW() WHERE id = $2', [recurrenceInterval, id]);
    }
    if (updates.recurrenceUntil !== undefined) {
        const recurrenceUntil = updates.recurrenceUntil || null;
        await query('UPDATE events SET recurrence_until = $1, updated_at = NOW() WHERE id = $2', [recurrenceUntil, id]);
    }

    return await getEventById(id);
}

async function deleteEvent(id) {
    const event = await getEventById(id);
    if (!event) {
        throw new Error('Event not found');
    }

    await query('DELETE FROM events WHERE id = $1', [id]);
    return event;
}

async function bulkCreateEvents(events) {
    const createdEvents = [];
    for (const eventData of events) {
        const created = await createEvent(eventData);
        createdEvents.push(created);
    }
    return createdEvents;
}

module.exports = {
    initializeDB,
    createUser,
    getUserByEmail,
    getUserById,
    updateUser,
    deleteUser,
    verifyPassword,
    createFamily,
    getFamilyById,
    getFamilyMembers,
    createInvitation,
    getInvitationById,
    getInvitationsByEmail,
    updateInvitationStatus,
    getFamilyInvitations,
    // Event operations
    createEvent,
    getEventById,
    getEventsByFamily,
    getEventsByMonth,
    updateEvent,
    deleteEvent,
    bulkCreateEvents
};
