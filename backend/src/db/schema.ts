import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { dirname } from 'path'
import { migrate } from './migration-runner'
import { allMigrations } from './migrations'
import { ensureOpenCodeModelStateTable } from './model-state'
import { ensureAssistantRepo } from './queries'
import { mkdirSyncSafe } from '../utils/fs-safe'

export function initializeDatabase(dbPath: string = './data/opencode.db'): Database {
  mkdirSyncSafe(dirname(dbPath))
  const db = new Database(dbPath)

  migrate(db, allMigrations)
  ensureOpenCodeModelStateTable(db)

  db.prepare('INSERT OR IGNORE INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)')
    .run('default', '{}', Date.now())
  ensureAssistantRepo(db)

  logger.info('Database initialized successfully')

  return db
}
