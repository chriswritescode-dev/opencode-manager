import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { selectRow, selectRows, selectTableColumns } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'

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

const IndexInfoSchema = z.object({ name: z.string() })
const PushSubscriptionRowSchema = z.object({
  endpoint: z.string(),
  session_id: z.string().nullable(),
})
const AppliedMigrationRowSchema = z.object({ id: z.string() })

function columnNames(db: Database): string[] {
  return selectTableColumns(db, 'push_subscriptions').map((column) => column.name)
}

function indexNames(db: Database): string[] {
  return selectRows(db, IndexInfoSchema, 'PRAGMA index_list(push_subscriptions)').map((index) => index.name)
}

describe('push subscription session id migration', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('creates the push subscriptions table with its session id column', () => {
    db = createTestDatabase()

    expect(columnNames(db)).toContain('session_id')
    expect(indexNames(db)).toContain('idx_push_sub_session')
    expect(indexNames(db)).toContain('idx_push_sub_endpoint')
  })

  it('adds the session id column to an existing table without losing subscriptions', () => {
    db = new Database(':memory:')
    db.run(LEGACY_TABLE)
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('user-1', 'https://push.example.com/legacy', 'p256dh-key', 'auth-key', 'Old Phone', 1, 1)

    migrate(db, allMigrations)

    expect(columnNames(db)).toContain('session_id')
    expect(indexNames(db)).toContain('idx_push_sub_session')
    expect(selectRows(db, PushSubscriptionRowSchema, 'SELECT endpoint, session_id FROM push_subscriptions')).toEqual([
      { endpoint: 'https://push.example.com/legacy', session_id: null },
    ])
    expect(
      selectRow(db, AppliedMigrationRowSchema, 'SELECT id FROM applied_migrations WHERE id = ?', MIGRATION_ID),
    ).toEqual({ id: MIGRATION_ID })
  })

  it('can run again on a database that always had the column', () => {
    db = createTestDatabase()
    db.prepare('DELETE FROM applied_migrations WHERE id = ?').run(MIGRATION_ID)

    migrate(db, allMigrations)

    expect(columnNames(db).filter((name) => name === 'session_id')).toHaveLength(1)
    expect(indexNames(db).filter((name) => name === 'idx_push_sub_session')).toHaveLength(1)
  })
})
