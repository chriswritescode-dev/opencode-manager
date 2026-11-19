import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { logger } from '../utils/logger'
import { selectRows } from './rows'

export interface Migration {
  id: string
  legacy?: { version: number; name: string }
  up(db: Database): void
  down(db: Database): void
}

const AppliedMigrationIdRowSchema = z.object({ id: z.string() })

const LegacyMigrationRecordSchema = z.object({
  version: z.number(),
  name: z.string(),
  applied_at: z.number(),
})

export function migrate(db: Database, migrations: Migration[]): void {
  assertUniqueIds(migrations)
  db.run('CREATE TABLE IF NOT EXISTS applied_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  adoptLegacyMigrations(db, migrations)

  const applied = new Set(selectRows(db, AppliedMigrationIdRowSchema, 'SELECT id FROM applied_migrations').map((row) => row.id))
  const pending = migrations.filter((migration) => !applied.has(migration.id))

  if (pending.length === 0) {
    logger.info('Database schema is up to date')
    return
  }

  logger.info(`Running ${pending.length} pending migration(s)`)

  for (const migration of pending) {
    logger.info(`Applying migration ${migration.id}`)
    db.run('BEGIN TRANSACTION')
    try {
      migration.up(db)
      db.prepare('INSERT INTO applied_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, Date.now())
      db.run('COMMIT')
      logger.info(`Migration ${migration.id} applied successfully`)
    } catch (error) {
      db.run('ROLLBACK')
      logger.error(`Migration ${migration.id} failed:`, error)
      throw error
    }
  }

  logger.info('All migrations applied successfully')
}

function assertUniqueIds(migrations: Migration[]): void {
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (seen.has(migration.id)) throw new Error(`Duplicate migration id "${migration.id}"`)
    seen.add(migration.id)
  }
}

function adoptLegacyMigrations(db: Database, migrations: Migration[]): void {
  const hasLegacyTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!hasLegacyTable) return

  const legacyRecords = selectRows(db, LegacyMigrationRecordSchema, 'SELECT version, name, applied_at FROM schema_migrations')
  const records = new Map(legacyRecords.map((record) => [record.version, record] as const))
  const adopted = migrations.flatMap((migration) => {
    const record = migration.legacy ? records.get(migration.legacy.version) : undefined
    if (!migration.legacy || !record) return []
    if (record.name !== migration.legacy.name) {
      logger.warn(
        `Migration version ${migration.legacy.version} is recorded as "${record.name}" but the code defines "${migration.legacy.name}". ` +
        `This migration was skipped; its schema changes may be missing. Verify the database schema and apply the changes manually if needed.`,
      )
    }
    return [{ id: migration.id, appliedAt: record.applied_at }]
  })
  if (adopted.length === 0) return

  const insert = db.prepare('INSERT OR IGNORE INTO applied_migrations (id, applied_at) VALUES (?, ?)')
  db.run('BEGIN TRANSACTION')
  try {
    adopted.forEach((entry) => insert.run(entry.id, entry.appliedAt))
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}
