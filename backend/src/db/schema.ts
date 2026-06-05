import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { migrate } from './migration-runner'
import { allMigrations } from './migrations'
import { ensureOpenCodeModelStateTable } from './model-state'

export function initializeDatabase(dbPath: string = './data/opencode.db'): Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)

  // Enable foreign key enforcement so ON DELETE CASCADE works.
  // SQLite defaults to OFF, and bun:sqlite inherits this default.
  db.exec('PRAGMA foreign_keys = ON')

  migrate(db, allMigrations)
  ensureOpenCodeModelStateTable(db)

  db.prepare('INSERT OR IGNORE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run('default', '{}', Date.now())

  logger.info('Database initialized successfully')

  return db
}
