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

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as MigrationRecord[]
  return new Set(rows.map(r => r.version))
}

function markApplied(db: Database, migration: Migration): void {
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(migration.version, migration.name, Date.now())
}

function markReverted(db: Database, version: number): void {
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version)
}

export function migrate(db: Database, migrations: Migration[]): void {
  ensureMigrationsTable(db)

  const applied = getAppliedVersions(db)
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

export function rollback(db: Database, migrations: Migration[], targetVersion?: number): void {
  ensureMigrationsTable(db)

  const applied = getAppliedVersions(db)
  const sorted = [...migrations]
    .filter(m => applied.has(m.version))
    .sort((a, b) => b.version - a.version)

  if (sorted.length === 0) {
    logger.info('No migrations to rollback')
    return
  }

  const latest = sorted[0]
  if (!latest) {
    logger.info('No migrations to rollback')
    return
  }
  const target = targetVersion ?? latest.version - 1

  const toRevert = sorted.filter(m => m.version > target)

  if (toRevert.length === 0) {
    logger.info('No migrations to rollback')
    return
  }

  logger.info(`Rolling back ${toRevert.length} migration(s) to version ${target}`)

  for (const migration of toRevert) {
    logger.info(`Reverting migration ${migration.version}: ${migration.name}`)
    db.run('BEGIN TRANSACTION')
    try {
      migration.down(db)
      markReverted(db, migration.version)
      db.run('COMMIT')
      logger.info(`Migration ${migration.version} reverted successfully`)
    } catch (error) {
      db.run('ROLLBACK')
      logger.error(`Rollback of migration ${migration.version} failed:`, error)
      throw error
    }
  }

  logger.info('Rollback completed successfully')
}
