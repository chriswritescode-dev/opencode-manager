import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202610291200-drop-session-goals'

function migrateUntil(db: Database, predicate: (id: string) => boolean): void {
  const upToInclusiveIndex = allMigrations.findIndex((entry) => predicate(entry.id))
  if (upToInclusiveIndex < 0) {
    throw new Error('Migration not found')
  }
  migrate(db, allMigrations.slice(0, upToInclusiveIndex + 1))
}

function tableExists(db: Database, name: string): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}

function indexNames(db: Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session_goals'").all() as Array<{
    name: string
  }>).map((row) => row.name)
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
    db?.close()
  })

  it('drops the table and its indexes from a database that still has session goal rows', () => {
    db = new Database(':memory:')
    migrateUntil(db, (id) => id === '202610181300-session-server-scope')
    insertOpenGoalRow(db, 'ses_existing')

    expect((db.prepare('SELECT COUNT(*) AS count FROM session_goals').get() as { count: number }).count).toBe(1)
    expect(tableExists(db, 'session_goals')).toBe(true)

    migrate(db, allMigrations)

    expect(tableExists(db, 'session_goals')).toBe(false)
    expect(indexNames(db).filter((name) => name.startsWith('idx_session_goals_'))).toEqual([])
  })

  it('leaves a fresh database without the session goals table', () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    expect(tableExists(db, 'session_goals')).toBe(false)
    expect(indexNames(db).filter((name) => name.startsWith('idx_session_goals_'))).toEqual([])
  })

  it('recreates the table and indexes when rolled back', () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    migration.down(db)

    expect(tableExists(db, 'session_goals')).toBe(true)
    expect(indexNames(db)).toEqual(expect.arrayContaining(['idx_session_goals_open', 'idx_session_goals_session']))
  })

  it('recreates a table that accepts an open goal row and enforces the open index', () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    migration.down(db)

    insertOpenGoalRow(db, 'ses_shared')

    expect(() => insertOpenGoalRow(db, 'ses_shared')).toThrow(/UNIQUE constraint failed/i)
  })
})
