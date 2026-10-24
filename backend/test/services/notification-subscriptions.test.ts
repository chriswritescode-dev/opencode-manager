import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { NotificationService } from '../../src/services/notification'
import {
  deletePushSubscriptionsForSession,
  ensurePushSubscriptionsTable,
} from '../../src/db/push-subscriptions'

const USER_ID = 'user-1'

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

function columnNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name)
}

function indexNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>)
    .map((index) => index.name)
}

function sessionIdOf(db: Database, endpoint: string): string | null {
  const row = db
    .prepare('SELECT session_id FROM push_subscriptions WHERE endpoint = ?')
    .get(endpoint) as { session_id: string | null } | undefined
  expect(row).toBeDefined()
  return row!.session_id
}

function endpointsOf(db: Database): string[] {
  return (db.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all() as Array<{ endpoint: string }>)
    .map((row) => row.endpoint)
}

describe('push subscription sessions', () => {
  let db: Database
  let service: NotificationService

  beforeEach(() => {
    db = new Database(':memory:')
    service = new NotificationService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('stores the session that registered the subscription', () => {
    service.saveSubscription(USER_ID, 'https://push.example.com/phone', 'p256dh-key', 'auth-key', 'Phone', 'ses_phone')

    expect(sessionIdOf(db, 'https://push.example.com/phone')).toBe('ses_phone')
  })

  it('stores no session for a subscription registered without one', () => {
    service.saveSubscription(USER_ID, 'https://push.example.com/anonymous', 'p256dh-key', 'auth-key', 'Browser')

    expect(sessionIdOf(db, 'https://push.example.com/anonymous')).toBeNull()
  })

  it('replaces the session id when the same endpoint subscribes again', () => {
    const endpoint = 'https://push.example.com/phone'
    service.saveSubscription(USER_ID, endpoint, 'p256dh-key', 'auth-key', 'Phone', 'ses_old')
    service.saveSubscription(USER_ID, endpoint, 'p256dh-key-2', 'auth-key-2', 'Phone', 'ses_new')

    expect(sessionIdOf(db, endpoint)).toBe('ses_new')
    expect(service.getSubscriptions(USER_ID)).toHaveLength(1)
  })

  it('keeps the stored device name when the same endpoint subscribes again without one', () => {
    const endpoint = 'https://push.example.com/phone'
    service.saveSubscription(USER_ID, endpoint, 'p256dh-key', 'auth-key', 'Phone', 'ses_old')
    const resubscribed = service.saveSubscription(USER_ID, endpoint, 'p256dh-key', 'auth-key', undefined, 'ses_new')

    expect(resubscribed.deviceName).toBe('Phone')
    expect(sessionIdOf(db, endpoint)).toBe('ses_new')
    expect(service.getSubscriptions(USER_ID)).toHaveLength(1)
  })

  it('adds the session id column to a database created before it existed', () => {
    const legacyDb = new Database(':memory:')
    legacyDb.run(LEGACY_TABLE)
    legacyDb
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(USER_ID, 'https://push.example.com/legacy', 'p256dh-key', 'auth-key', 'Old Phone', 1, 1)

    new NotificationService(legacyDb)

    expect(columnNames(legacyDb, 'push_subscriptions')).toContain('session_id')
    expect(indexNames(legacyDb, 'push_subscriptions')).toContain('idx_push_sub_session')
    expect(sessionIdOf(legacyDb, 'https://push.example.com/legacy')).toBeNull()
    legacyDb.close()
  })

  it('creates the session id column and index on a fresh database', () => {
    expect(columnNames(db, 'push_subscriptions')).toContain('session_id')
    expect(indexNames(db, 'push_subscriptions')).toContain('idx_push_sub_session')
  })

  it('leaves the schema unchanged when the table is ensured twice', () => {
    ensurePushSubscriptionsTable(db)
    ensurePushSubscriptionsTable(db)

    expect(columnNames(db, 'push_subscriptions').filter((name) => name === 'session_id')).toHaveLength(1)
    expect(indexNames(db, 'push_subscriptions').filter((name) => name === 'idx_push_sub_session')).toHaveLength(1)
  })

  it('deletes only the subscriptions of the revoked session', () => {
    service.saveSubscription(USER_ID, 'https://push.example.com/phone', 'p256dh-key', 'auth-key', 'Phone', 'ses_phone')
    service.saveSubscription(USER_ID, 'https://push.example.com/desktop', 'p256dh-key', 'auth-key', 'Desktop', 'ses_desktop')
    service.saveSubscription(USER_ID, 'https://push.example.com/legacy', 'p256dh-key', 'auth-key', 'Legacy')

    expect(deletePushSubscriptionsForSession(db, 'ses_phone')).toBe(1)
    expect(endpointsOf(db)).toEqual([
      'https://push.example.com/desktop',
      'https://push.example.com/legacy',
    ])
  })
})
