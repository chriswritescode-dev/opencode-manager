import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202611161200-drop-session-sandbox-resources'
import { selectRow, selectTableColumns } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'

const LegacyRowSchema = z.object({
  sandboxed: z.number(),
  source: z.string(),
  toggled_at: z.number(),
})

function migrateUntil(db: Database, id: string): void {
  const upToExclusiveIndex = allMigrations.findIndex((entry) => entry.id === id)
  if (upToExclusiveIndex < 0) {
    throw new Error('Migration not found')
  }
  migrate(db, allMigrations.slice(0, upToExclusiveIndex))
}

function columnNames(db: Database, table: string): string[] {
  return selectTableColumns(db, table).map((column) => column.name)
}

function addLegacyResourceColumns(db: Database): void {
  db.run('ALTER TABLE session_sandbox_modes ADD COLUMN cpus INTEGER')
  db.run('ALTER TABLE session_sandbox_modes ADD COLUMN memory_mib INTEGER')
}

function insertLegacyRow(db: Database, sessionId: string): number {
  const now = Date.now()
  db.prepare(`
    INSERT INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, cpus, memory_mib, updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(sessionId, 1, 'user', now, 4, 8192, now)
  return now
}

describe('202611161200 drop session sandbox resources migration', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('drops the resource columns and keeps the remaining row data', () => {
    db = new Database(':memory:')
    migrateUntil(db, '202611161200-drop-session-sandbox-resources')
    addLegacyResourceColumns(db)
    const toggledAt = insertLegacyRow(db, 'ses_existing')

    expect(columnNames(db, 'session_sandbox_modes')).toEqual(expect.arrayContaining(['cpus', 'memory_mib']))

    migrate(db, allMigrations)

    const columns = columnNames(db, 'session_sandbox_modes')
    expect(columns).not.toContain('cpus')
    expect(columns).not.toContain('memory_mib')
    expect(selectRow(
      db,
      LegacyRowSchema,
      'SELECT sandboxed, source, toggled_at FROM session_sandbox_modes WHERE session_id = ?',
      'ses_existing',
    )).toEqual({ sandboxed: 1, source: 'user', toggled_at: toggledAt })
  })

  it('leaves a fresh database without the resource columns', () => {
    db = createTestDatabase()

    const columns = columnNames(db, 'session_sandbox_modes')
    expect(columns).not.toContain('cpus')
    expect(columns).not.toContain('memory_mib')
  })

  it('is a no-op when rolled back', () => {
    db = createTestDatabase()

    migration.down(db)

    const columns = columnNames(db, 'session_sandbox_modes')
    expect(columns).not.toContain('cpus')
    expect(columns).not.toContain('memory_mib')
  })

  it('is a no-op when the table is missing', () => {
    db = new Database(':memory:')

    expect(() => migration.up(db)).not.toThrow()
  })
})
