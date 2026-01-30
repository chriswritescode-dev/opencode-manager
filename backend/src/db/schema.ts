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
    
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      command_type TEXT NOT NULL,
      command_config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
  `)
  
  runMigrations(db)
  
  // Force database file creation by performing a write
  db.prepare('INSERT OR IGNORE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run('default', '{}', Date.now())
  
  logger.info('Database initialized successfully')
  
  return db
}
