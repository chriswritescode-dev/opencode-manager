import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const MIGRATION_ID = '202610231200-push-subscription-session-id'

const LEGACY_TABLE = `
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_name TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )
`

function columnNames(db: Database): string[] {
  return (db.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{ name: string }>)
    .map((column) => column.name)
}

function indexNames(db: Database): string[] {
  return (db.prepare('PRAGMA index_list(push_subscriptions)').all() as Array<{ name: string }>)
    .map((index) => index.name)
}

describe('push subscription session id migration', () => {
  it('creates the push subscriptions table with its session id column', () => {
    const db = new Database(':memory:')
    migrate(db, allMigrations)

    expect(columnNames(db)).toContain('session_id')
    expect(indexNames(db)).toContain('idx_push_sub_session')
    expect(indexNames(db)).toContain('idx_push_sub_endpoint')
    db.close()
  })

  it('adds the session id column to an existing table without losing subscriptions', () => {
    const db = new Database(':memory:')
    db.run(LEGACY_TABLE)
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('user-1', 'https://push.example.com/legacy', 'p256dh-key', 'auth-key', 'Old Phone', 1, 1)

    migrate(db, allMigrations)

    expect(columnNames(db)).toContain('session_id')
    expect(indexNames(db)).toContain('idx_push_sub_session')
    expect(db.prepare('SELECT endpoint, session_id FROM push_subscriptions').all()).toEqual([
      { endpoint: 'https://push.example.com/legacy', session_id: null },
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM applied_migrations WHERE id = ?').get(MIGRATION_ID))
      .toEqual({ count: 1 })
    db.close()
  })

  it('can run again on a database that always had the column', () => {
    const db = new Database(':memory:')
    migrate(db, allMigrations)
    db.prepare('DELETE FROM applied_migrations WHERE id = ?').run(MIGRATION_ID)

    migrate(db, allMigrations)

    expect(columnNames(db).filter((name) => name === 'session_id')).toHaveLength(1)
    expect(indexNames(db).filter((name) => name === 'idx_push_sub_session')).toHaveLength(1)
    db.close()
  })
})
