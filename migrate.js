/**
 * Migration script to move data from JSON files to Vercel Postgres
 * Run this locally before deploying to Vercel
 *
 * Usage:
 *   node migrate.js
 *
 * Prerequisites:
 *   1. Set up Vercel Postgres database
 *   2. Run `vercel env pull .env.local` to get environment variables
 *   3. Ensure data/*.json files exist locally
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const fs = require('fs').promises;
const path = require('path');
const { sql } = require('@vercel/postgres');

const DATA_DIR = path.join(__dirname, 'data');

async function readJSONFile(filename) {
    try {
        const filePath = path.join(DATA_DIR, filename);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.log(`⚠️  File ${filename} not found or empty, skipping...`);
        return [];
    }
}

async function migrateData() {
    console.log('🚀 Starting migration from JSON to Postgres...\n');

    try {
        // 1. Create tables
        console.log('📊 Creating database schema...');
        await sql`
            CREATE TABLE IF NOT EXISTS families (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await sql`
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
        `;

        await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id)`;

        await sql`
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
        `;

        await sql`CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_invitations_family ON invitations(family_id)`;

        await sql`
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        `;

        await sql`CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id)`;

        console.log('✅ Schema created\n');

        // 2. Migrate families
        console.log('👨‍👩‍👧‍👦 Migrating families...');
        const families = await readJSONFile('families.json');
        let familyCount = 0;
        for (const family of families) {
            try {
                await sql`
                    INSERT INTO families (id, name, created_by, created_at)
                    VALUES (${family.id}, ${family.name}, ${family.createdBy}, ${family.createdAt})
                    ON CONFLICT (id) DO NOTHING
                `;
                familyCount++;
            } catch (err) {
                console.error(`Error migrating family ${family.id}:`, err.message);
            }
        }
        console.log(`✅ Migrated ${familyCount} families\n`);

        // 3. Migrate users
        console.log('👤 Migrating users...');
        const users = await readJSONFile('users.json');
        let userCount = 0;
        for (const user of users) {
            try {
                await sql`
                    INSERT INTO users (id, email, name, password, role, family_id, created_at, updated_at)
                    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.password}, ${user.role}, ${user.familyId}, ${user.createdAt}, ${user.updatedAt || null})
                    ON CONFLICT (email) DO NOTHING
                `;
                userCount++;
            } catch (err) {
                console.error(`Error migrating user ${user.email}:`, err.message);
            }
        }
        console.log(`✅ Migrated ${userCount} users\n`);

        // 4. Migrate invitations
        console.log('✉️  Migrating invitations...');
        const invitations = await readJSONFile('invitations.json');
        let invitationCount = 0;
        for (const invite of invitations) {
            try {
                await sql`
                    INSERT INTO invitations (id, email, family_id, invited_by, role, status, created_at, updated_at, expires_at)
                    VALUES (${invite.id}, ${invite.email}, ${invite.familyId}, ${invite.invitedBy}, ${invite.role}, ${invite.status}, ${invite.createdAt}, ${invite.updatedAt || null}, ${invite.expiresAt})
                    ON CONFLICT (id) DO NOTHING
                `;
                invitationCount++;
            } catch (err) {
                console.error(`Error migrating invitation ${invite.id}:`, err.message);
            }
        }
        console.log(`✅ Migrated ${invitationCount} invitations\n`);

        // 5. Migrate events
        console.log('📅 Migrating events...');
        const events = await readJSONFile('events.json');
        let eventCount = 0;
        for (const event of events) {
            try {
                await sql`
                    INSERT INTO events (id, title, date, time, description, color, emoji, owner_id, family_id, visibility, created_at, updated_at)
                    VALUES (
                        ${event.id},
                        ${event.title},
                        ${event.date},
                        ${event.time || ''},
                        ${event.description || ''},
                        ${event.color || 'blue'},
                        ${event.emoji || ''},
                        ${event.ownerId},
                        ${event.familyId},
                        ${event.visibility || 'shared'},
                        ${event.createdAt},
                        ${event.updatedAt || null}
                    )
                    ON CONFLICT (id) DO NOTHING
                `;
                eventCount++;
            } catch (err) {
                console.error(`Error migrating event ${event.id}:`, err.message);
            }
        }
        console.log(`✅ Migrated ${eventCount} events\n`);

        console.log('🎉 Migration completed successfully!\n');
        console.log('Summary:');
        console.log(`  - Families: ${familyCount}`);
        console.log(`  - Users: ${userCount}`);
        console.log(`  - Invitations: ${invitationCount}`);
        console.log(`  - Events: ${eventCount}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateData()
    .then(() => {
        console.log('\n✅ Migration script finished');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Migration script failed:', error);
        process.exit(1);
    });
