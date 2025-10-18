-- Family Calendar Database Schema for Vercel Postgres

-- Families table
CREATE TABLE IF NOT EXISTS families (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'adult', 'child')),
    family_id VARCHAR(255) REFERENCES families(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id);

-- Invitations table
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
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_family ON invitations(family_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);

-- Events table
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
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
