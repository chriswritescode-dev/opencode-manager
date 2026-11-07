import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202611070100-drop-change-walkthroughs'

function migrateUntil(db: Database, id: string): void {
  const upToInclusiveIndex = allMigrations.findIndex((entry) => entry.id === id)
  if (upToInclusiveIndex < 0) {
    throw new Error('Migration not found')
  }
  migrate(db, allMigrations.slice(0, upToInclusiveIndex + 1))
}

function tableExists(db: Database, name: string): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}

function insertWalkthroughRow(db: Database): void {
  db.prepare(`
    INSERT INTO change_walkthroughs(session_id, source_key, diff_hash, generation_id, status, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run('ses_existing', 'session', 'h', 'g', 'ready', 1, 1)
}

describe('202611070100 drop change walkthroughs migration', () => {
  let db: Database

  afterEach(() => {
    db?.close()
  })

  it('drops the table from a database that still has walkthrough rows', () => {
    db = new Database(':memory:')
    migrateUntil(db, '202611070000-outputs')
    insertWalkthroughRow(db)

    expect(tableExists(db, 'change_walkthroughs')).toBe(true)
    expect((db.prepare('SELECT COUNT(*) AS count FROM change_walkthroughs').get() as { count: number }).count).toBe(1)

    migrate(db, allMigrations)

    expect(tableExists(db, 'change_walkthroughs')).toBe(false)
    expect(tableExists(db, 'output_definitions')).toBe(true)
    expect(tableExists(db, 'outputs')).toBe(true)
  })

  it('leaves a fresh database without the table', () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    expect(tableExists(db, 'change_walkthroughs')).toBe(false)
  })

  it('recreates the table when rolled back', () => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    migration.down(db)

    expect(tableExists(db, 'change_walkthroughs')).toBe(true)
    expect(() => insertWalkthroughRow(db)).not.toThrow()
  })
})
