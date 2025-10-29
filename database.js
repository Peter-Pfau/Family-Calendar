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

        // Create day backgrounds table
        await query(`
            CREATE TABLE IF NOT EXISTS day_backgrounds (
                id VARCHAR(255) PRIMARY KEY,
                family_id VARCHAR(255) REFERENCES families(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                image_data TEXT NOT NULL,
                created_by VARCHAR(255) REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(family_id, date)
            )
        `);
        await query(`CREATE INDEX IF NOT EXISTS idx_day_backgrounds_family ON day_backgrounds(family_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_day_backgrounds_date ON day_backgrounds(date)`);

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

async function updateUserForInvitation(userId, { password, name, role, familyId }) {
    const updates = [];
    const params = [];
    let index = 1;

    if (name) {
        updates.push(`name = $${index++}`);
        params.push(name);
    }

    if (role) {
        updates.push(`role = $${index++}`);
        params.push(role);
    }

    if (familyId) {
        updates.push(`family_id = $${index++}`);
        params.push(familyId);
    }

    if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        updates.push(`password = $${index++}`);
        params.push(hashedPassword);
    }

    if (updates.length === 0) {
        return await getUserById(userId);
    }

    updates.push('updated_at = NOW()');

    params.push(userId);

    await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${index}`,
        params
    );

    return await getUserById(userId);
}

async function cancelInvitation(invitationId, familyId) {
    const result = await query(
        'UPDATE invitations SET status = $1, updated_at = NOW() WHERE id = $2 AND family_id = $3 RETURNING *',
        ['cancelled', invitationId, familyId]
    );
    return result.rows[0] || null;
}

async function resendInvitation(invitationId, familyId, invitedBy) {
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await query(
        'UPDATE invitations SET status = $1, invited_by = $2, expires_at = $3, updated_at = NOW() WHERE id = $4 AND family_id = $5 RETURNING *',
        ['pending', invitedBy, newExpiry, invitationId, familyId]
    );
    return result.rows[0] || null;
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
    let skippedCount = 0;
    const seenKeys = new Set();

    for (const eventData of events) {
        if (!eventData || !eventData.title || !eventData.date || !eventData.familyId) {
            skippedCount += 1;
            continue;
        }

        const normalizedTitle = eventData.title.trim();
        const normalizedTime = (eventData.time || '').trim();
        const dedupeKey = [
            eventData.familyId,
            normalizedTitle.toLowerCase(),
            eventData.date,
            normalizedTime
        ].join('|');

        if (seenKeys.has(dedupeKey)) {
            skippedCount += 1;
            continue;
        }
        seenKeys.add(dedupeKey);

        const existing = await query(
            `SELECT id FROM events
             WHERE family_id = $1
               AND LOWER(title) = $2
               AND date = $3
               AND COALESCE(time, '') = $4
             LIMIT 1`,
            [eventData.familyId, normalizedTitle.toLowerCase(), eventData.date, normalizedTime]
        );

        if (existing.rows.length > 0) {
            skippedCount += 1;
            continue;
        }

        const created = await createEvent({
            ...eventData,
            title: normalizedTitle,
            time: normalizedTime
        });
        createdEvents.push(created);
    }

    return {
        created: createdEvents,
        skipped: skippedCount
    };
}

async function setDayBackground(familyId, date, imageData, userId) {
    const existing = await query('SELECT id FROM day_backgrounds WHERE family_id = $1 AND date = $2 LIMIT 1', [familyId, date]);
    const backgroundId = existing.rows[0]?.id || ('bg_' + Math.random().toString(36).substring(2) + Date.now().toString(36));

    await query(`
        INSERT INTO day_backgrounds (id, family_id, date, image_data, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (family_id, date)
        DO UPDATE SET image_data = EXCLUDED.image_data, updated_at = NOW(), created_by = EXCLUDED.created_by
    `, [backgroundId, familyId, date, imageData, userId]);

    const result = await query(`
        SELECT
            id,
            family_id,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            image_data AS "imageData"
        FROM day_backgrounds
        WHERE id = $1
        LIMIT 1
    `, [backgroundId]);

    return result.rows[0] || null;
}

async function getDayBackgroundsByFamily(familyId) {
    const result = await query(`
        SELECT
            id,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            image_data AS "imageData"
        FROM day_backgrounds
        WHERE family_id = $1
        ORDER BY date ASC
    `, [familyId]);

    return result.rows;
}

async function deleteDayBackground(familyId, date) {
    await query('DELETE FROM day_backgrounds WHERE family_id = $1 AND date = $2', [familyId, date]);
}

async function getActiveSessions({ limit = 100, familyId } = {}) {
    const numericLimit = Number(limit) || 100;
    const boundedLimit = Math.max(1, Math.min(500, numericLimit));
    const params = [boundedLimit];
    let familyFilterClause = '';
    if (familyId) {
        params.push(familyId);
        familyFilterClause = 'WHERE s.sess #>> \'{familyId}\' = $2';
    }

    const result = await query(`
        SELECT
            s.sid,
            s.expire,
            s.sess,
            s.sess #>> '{userId}' AS user_id,
            s.sess #>> '{userRole}' AS user_role,
            s.sess #>> '{familyId}' AS family_id,
            u.email,
            u.name
        FROM sessions s
        LEFT JOIN users u ON u.id = s.sess #>> '{userId}'
        ${familyFilterClause}
        ORDER BY s.expire DESC
        LIMIT $1
    `, params);

    return result.rows.map(row => {
        const sessionData = row.sess || {};
        const cookie = sessionData.cookie || {};
        const expiresAt = row.expire instanceof Date ? row.expire.toISOString() : row.expire;
        const maxAge = typeof cookie.originalMaxAge === 'number'
            ? cookie.originalMaxAge
            : (cookie.maxAge ?? null);

        return {
            sid: row.sid,
            userId: sessionData.userId || row.user_id || null,
            userRole: sessionData.userRole || row.user_role || null,
            familyId: sessionData.familyId || row.family_id || null,
            userEmail: row.email || null,
            userName: row.name || null,
            expiresAt,
            isExpired: expiresAt ? new Date(expiresAt) < new Date() : null,
            cookie: {
                secure: Boolean(cookie.secure),
                httpOnly: Boolean(cookie.httpOnly),
                sameSite: cookie.sameSite || null,
                maxAge
            },
            sessionData
        };
    });
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
    updateUserForInvitation,
    cancelInvitation,
    resendInvitation,
    getFamilyInvitations,
    // Event operations
    createEvent,
    getEventById,
    getEventsByFamily,
    getEventsByMonth,
    updateEvent,
    deleteEvent,
    bulkCreateEvents,
    setDayBackground,
    getDayBackgroundsByFamily,
    deleteDayBackground,
    getActiveSessions
};
