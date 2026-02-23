import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 1,
  name: 'base-schema',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT,
        local_path TEXT NOT NULL,
        branch TEXT,
        default_branch TEXT,
        clone_status TEXT NOT NULL,
        cloned_at INTEGER NOT NULL,
        last_pulled INTEGER,
        opencode_config_name TEXT,
        is_worktree BOOLEAN DEFAULT FALSE,
        is_local BOOLEAN DEFAULT FALSE
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_repo_clone_status ON repos(clone_status)')

    db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        preferences TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id)
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_user_id ON user_preferences(user_id)')

    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        config_name TEXT NOT NULL,
        config_content TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, config_name)
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_user_id ON opencode_configs(user_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_default ON opencode_configs(user_id, is_default)')

    db.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        emailVerified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        role TEXT DEFAULT 'user'
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS "session" (
        id TEXT PRIMARY KEY NOT NULL,
        expiresAt INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        ipAddress TEXT,
        userAgent TEXT,
        userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"(userId)')
    db.run('CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token)')

    db.run(`
      CREATE TABLE IF NOT EXISTS "account" (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL,
        providerId TEXT NOT NULL,
        userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        accessToken TEXT,
        refreshToken TEXT,
        idToken TEXT,
        accessTokenExpiresAt INTEGER,
        refreshTokenExpiresAt INTEGER,
        scope TEXT,
        password TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"(userId)')
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON "account"(providerId, accountId)')

    db.run(`
      CREATE TABLE IF NOT EXISTS "verification" (
        id TEXT PRIMARY KEY NOT NULL,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER,
        updatedAt INTEGER
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier)')

    db.run(`
      CREATE TABLE IF NOT EXISTS "passkey" (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        publicKey TEXT NOT NULL,
        userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        credentialID TEXT NOT NULL,
        counter INTEGER NOT NULL,
        deviceType TEXT NOT NULL,
        backedUp INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        createdAt INTEGER,
        aaguid TEXT
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_passkey_userId ON "passkey"(userId)')
    db.run('CREATE INDEX IF NOT EXISTS idx_passkey_credentialID ON "passkey"(credentialID)')

    db.run(`
      CREATE TABLE IF NOT EXISTS trusted_ssh_hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host TEXT NOT NULL UNIQUE,
        key_type TEXT NOT NULL,
        public_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_trusted_ssh_hosts_host ON trusted_ssh_hosts(host)')

    db.run(`
      CREATE TABLE IF NOT EXISTS repo_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(repo_id, key)
      )
    `)

    db.run('CREATE INDEX IF NOT EXISTS idx_repo_settings_repo ON repo_settings(repo_id)')
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS repo_settings')
    db.run('DROP TABLE IF EXISTS trusted_ssh_hosts')
    db.run('DROP TABLE IF EXISTS "passkey"')
    db.run('DROP TABLE IF EXISTS "verification"')
    db.run('DROP TABLE IF EXISTS "account"')
    db.run('DROP TABLE IF EXISTS "session"')
    db.run('DROP TABLE IF EXISTS "user"')
    db.run('DROP TABLE IF EXISTS opencode_configs')
    db.run('DROP TABLE IF EXISTS user_preferences')
    db.run('DROP TABLE IF EXISTS repos')
  },
}

export default migration
