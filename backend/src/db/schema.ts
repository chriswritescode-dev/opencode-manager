import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { runMigrations } from './migrations'

export function initializeDatabase(dbPath: string = './data/opencode.db'): Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  
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
    );
    
    CREATE INDEX IF NOT EXISTS idx_repo_clone_status ON repos(clone_status);
    
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      preferences TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_id ON user_preferences(user_id);
    
    CREATE TABLE IF NOT EXISTS opencode_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      config_name TEXT NOT NULL,
      config_content TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, config_name)
    );
    
    CREATE INDEX IF NOT EXISTS idx_opencode_user_id ON opencode_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_opencode_default ON opencode_configs(user_id, is_default);
    
    -- Better Auth tables
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      role TEXT DEFAULT 'user'
    );
    
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY NOT NULL,
      expiresAt INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"(userId);
    CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);
    
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
    );
    
    CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"(userId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON "account"(providerId, accountId);
    
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY NOT NULL,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      createdAt INTEGER,
      updatedAt INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier);
    
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
    );
    
    CREATE INDEX IF NOT EXISTS idx_passkey_userId ON "passkey"(userId);
    CREATE INDEX IF NOT EXISTS idx_passkey_credentialID ON "passkey"(credentialID);

    CREATE TABLE IF NOT EXISTS trusted_ssh_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL UNIQUE,
      key_type TEXT NOT NULL,
      public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trusted_ssh_hosts_host ON trusted_ssh_hosts(host);
  `)
  
  runMigrations(db)
  
  db.prepare('INSERT OR IGNORE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run('default', '{}', Date.now())
  
  logger.info('Database initialized successfully')
  
  return db
}
