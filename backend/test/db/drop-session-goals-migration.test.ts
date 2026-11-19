import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202610291200-drop-session-goals'
import { selectRow, selectRows } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'

const TableNameRowSchema = z.object({ name: z.string() })
const IndexNameRowSchema = z.object({ name: z.string() })
const RowCountSchema = z.object({ count: z.number() })

function migrateUntil(db: Database, predicate: (id: string) => boolean): void {
  const upToInclusiveIndex = allMigrations.findIndex((entry) => predicate(entry.id))
  if (upToInclusiveIndex < 0) {
    throw new Error('Migration not found')
  }
  migrate(db, allMigrations.slice(0, upToInclusiveIndex + 1))
}

function tableExists(db: Database, name: string): boolean {
  return selectRow(db, TableNameRowSchema, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== null
}

function indexNames(db: Database): string[] {
  return selectRows(
    db,
    IndexNameRowSchema,
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session_goals'",
  ).map((row) => row.name)
}

function insertOpenGoalRow(db: Database, sessionId: string): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO session_goals(session_id, directory, objective, status, turn_state, max_continuations, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(sessionId, '/repo', 'Ship it', 'active', 'waiting', 1, now, now)
}

describe('202610291200 drop session goals migration', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('drops the table and its indexes from a database that still has session goal rows', () => {
    db = new Database(':memory:')
    migrateUntil(db, (id) => id === '202610181300-session-server-scope')
    insertOpenGoalRow(db, 'ses_existing')

    expect(selectRow(db, RowCountSchema, 'SELECT COUNT(*) AS count FROM session_goals')).toEqual({ count: 1 })
    expect(tableExists(db, 'session_goals')).toBe(true)

    migrate(db, allMigrations)

    expect(tableExists(db, 'session_goals')).toBe(false)
    expect(indexNames(db).filter((name) => name.startsWith('idx_session_goals_'))).toEqual([])
  })

  it('leaves a fresh database without the session goals table', () => {
    db = createTestDatabase()

    expect(tableExists(db, 'session_goals')).toBe(false)
    expect(indexNames(db).filter((name) => name.startsWith('idx_session_goals_'))).toEqual([])
  })

  it('recreates the table and indexes when rolled back', () => {
    db = createTestDatabase()
    migration.down(db)

    expect(tableExists(db, 'session_goals')).toBe(true)
    expect(indexNames(db)).toEqual(expect.arrayContaining(['idx_session_goals_open', 'idx_session_goals_session']))
  })

  it('recreates a table that accepts an open goal row and enforces the open index', () => {
    db = createTestDatabase()
    migration.down(db)

    insertOpenGoalRow(db, 'ses_shared')

    expect(() => insertOpenGoalRow(db, 'ses_shared')).toThrow(/UNIQUE constraint failed/i)
  })
})
