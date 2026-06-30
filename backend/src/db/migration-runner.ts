import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export interface Migration {
  version: number
  name: string
  up(db: Database): void
  down(db: Database): void
}

interface MigrationRecord {
  version: number
  name: string
  applied_at: number
}

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
}

function getAppliedMigrations(db: Database): Map<number, string> {
  const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as MigrationRecord[]
  return new Map(rows.map(r => [r.version, r.name]))
}

/**
 * Surfaces version-number collisions where a recorded migration's name differs
 * from the code migration registered under the same version. The runner keys on
 * version number alone, so a reused version silently skips the real migration
 * (e.g. an ADD COLUMN), producing later runtime errors that are hard to trace.
 * This converts that silent skip into a loud, actionable warning.
 */
function warnOnVersionNameMismatch(applied: Map<number, string>, migrations: Migration[]): void {
  for (const migration of migrations) {
    const recordedName = applied.get(migration.version)
    if (recordedName !== undefined && recordedName !== migration.name) {
      logger.warn(
        `Migration version ${migration.version} is recorded as "${recordedName}" but the code defines "${migration.name}". ` +
        `This migration was skipped; its schema changes may be missing. Verify the database schema and apply the changes manually if needed.`,
      )
    }
  }
}

function markApplied(db: Database, migration: Migration): void {
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(migration.version, migration.name, Date.now())
}

export function migrate(db: Database, migrations: Migration[]): void {
  ensureMigrationsTable(db)

  const applied = getAppliedMigrations(db)
  warnOnVersionNameMismatch(applied, migrations)
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  const pending = sorted.filter(m => !applied.has(m.version))

  if (pending.length === 0) {
    logger.info('Database schema is up to date')
    return
  }

  logger.info(`Running ${pending.length} pending migration(s)`)

  for (const migration of pending) {
    logger.info(`Applying migration ${migration.version}: ${migration.name}`)
    db.run('BEGIN TRANSACTION')
    try {
      migration.up(db)
      markApplied(db, migration)
      db.run('COMMIT')
      logger.info(`Migration ${migration.version} applied successfully`)
    } catch (error) {
      db.run('ROLLBACK')
      logger.error(`Migration ${migration.version} failed:`, error)
      throw error
    }
  }

  logger.info('All migrations applied successfully')
}


