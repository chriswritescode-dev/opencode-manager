import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  deleteExpoPushReceipts,
  deleteExpoPushReceiptsCreatedBefore,
  deleteExpoPushTokensByValue,
  deleteExpoPushTokensForSessions,
  deleteExpoPushToken,
  ensureExpoPushTokensTable,
  insertExpoPushReceipts,
  listDueExpoPushReceipts,
  listExpoPushTokens,
  listExpoPushTokenUserIds,
  markExpoPushTokensUsed,
  upsertExpoPushToken,
} from '../../src/db/expo-push-tokens'
import { ExpoPushTokenRequestSchema } from '@opencode-manager/shared/schemas'

const MIGRATION_ID = '202611081200-expo-push-tokens'

function freshDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function columnNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
}

function indexNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((index) => index.name)
}

describe('expo push tokens schema', () => {
  it('creates both tables and all three indexes', () => {
    const db = freshDb()

    expect(columnNames(db, 'expo_push_tokens')).toEqual([
      'id',
      'user_id',
      'token',
      'device_name',
      'session_id',
      'created_at',
      'last_used_at',
    ])
    expect(columnNames(db, 'expo_push_receipts')).toEqual([
      'receipt_id',
      'token',
      'check_after',
      'created_at',
    ])
    expect(indexNames(db, 'expo_push_tokens')).toEqual(
      expect.arrayContaining(['idx_expo_push_tokens_user', 'idx_expo_push_tokens_session']),
    )
    expect(indexNames(db, 'expo_push_receipts')).toContain('idx_expo_push_receipts_check_after')
    db.close()
  })

  it('is a no-op when the migration is applied again', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[reapply]', now: 10 })

    db.prepare('DELETE FROM applied_migrations WHERE id = ?').run(MIGRATION_ID)
    migrate(db, allMigrations)

    expect(columnNames(db, 'expo_push_tokens').filter((name) => name === 'session_id')).toHaveLength(1)
    expect(indexNames(db, 'expo_push_tokens').filter((name) => name === 'idx_expo_push_tokens_user')).toHaveLength(1)
    expect(indexNames(db, 'expo_push_receipts').filter((name) => name === 'idx_expo_push_receipts_check_after')).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM expo_push_tokens').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM applied_migrations WHERE id = ?').get(MIGRATION_ID)).toEqual({ count: 1 })
    db.close()
  })

  it('is safe to ensure the schema twice without the migration runner', () => {
    const db = new Database(':memory:')
    ensureExpoPushTokensTable(db)
    ensureExpoPushTokensTable(db)

    expect(columnNames(db, 'expo_push_tokens').filter((name) => name === 'token')).toHaveLength(1)
    expect(indexNames(db, 'expo_push_tokens').filter((name) => name === 'idx_expo_push_tokens_session')).toHaveLength(1)
    db.close()
  })
})

describe('upsertExpoPushToken', () => {
  it('reassigns an existing token to the latest user and session and keeps the old device name', () => {
    const db = freshDb()
    const first = upsertExpoPushToken(db, {
      userId: 'user-a',
      token: 'ExpoPushToken[phone]',
      deviceName: 'Old Phone',
      sessionId: 'session-a',
      now: 100,
    })

    const second = upsertExpoPushToken(db, {
      userId: 'user-b',
      token: 'ExpoPushToken[phone]',
      sessionId: 'session-b',
      now: 200,
    })

    expect(first).toMatchObject({ id: second.id, userId: 'user-a', deviceName: 'Old Phone' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM expo_push_tokens').get()).toEqual({ count: 1 })
    expect(second).toEqual({
      id: first.id,
      userId: 'user-b',
      token: 'ExpoPushToken[phone]',
      deviceName: 'Old Phone',
      createdAt: 100,
      lastUsedAt: 200,
    })
    expect(db.prepare('SELECT session_id FROM expo_push_tokens WHERE id = ?').get(first.id)).toEqual({ session_id: 'session-b' })
    db.close()
  })
})

describe('deleteExpoPushToken', () => {
  it('only deletes when the user matches, unless no user is given', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[one]', now: 1 })

    expect(deleteExpoPushToken(db, 'ExpoPushToken[one]', 'user-b')).toBe(false)
    expect(deleteExpoPushToken(db, 'ExpoPushToken[one]', 'user-a')).toBe(true)

    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[two]', now: 2 })
    expect(deleteExpoPushToken(db, 'ExpoPushToken[two]')).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM expo_push_tokens').get()).toEqual({ count: 0 })
    db.close()
  })
})

describe('listExpoPushTokens', () => {
  it('filters by user and orders newest first', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[old]', now: 10 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[new]', now: 30 })
    upsertExpoPushToken(db, { userId: 'user-b', token: 'ExpoPushToken[other]', now: 20 })

    expect(listExpoPushTokens(db, 'user-a').map((record) => record.token)).toEqual([
      'ExpoPushToken[new]',
      'ExpoPushToken[old]',
    ])
    db.close()
  })
})

describe('listExpoPushTokenUserIds', () => {
  it('returns each user once', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[a1]', now: 1 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[a2]', now: 2 })
    upsertExpoPushToken(db, { userId: 'user-b', token: 'ExpoPushToken[b1]', now: 3 })

    expect(listExpoPushTokenUserIds(db).sort()).toEqual(['user-a', 'user-b'])
    db.close()
  })
})

describe('deleteExpoPushTokensByValue', () => {
  it('returns zero for an empty list and deletes only the listed tokens', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[keep]', now: 1 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[drop1]', now: 2 })
    upsertExpoPushToken(db, { userId: 'user-b', token: 'ExpoPushToken[drop2]', now: 3 })

    expect(deleteExpoPushTokensByValue(db, [])).toBe(0)
    expect(deleteExpoPushTokensByValue(db, ['ExpoPushToken[drop1]', 'ExpoPushToken[drop2]'])).toBe(2)
    expect(listExpoPushTokens(db, 'user-a').map((record) => record.token)).toEqual(['ExpoPushToken[keep]'])
    db.close()
  })
})

describe('markExpoPushTokensUsed', () => {
  it('sets last_used_at on the listed tokens only', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[used]', now: 10 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[unused]', now: 10 })

    markExpoPushTokensUsed(db, ['ExpoPushToken[used]'], 500)
    markExpoPushTokensUsed(db, [], 600)

    const records = listExpoPushTokens(db, 'user-a')
    expect(records.find((record) => record.token === 'ExpoPushToken[used]')?.lastUsedAt).toBe(500)
    expect(records.find((record) => record.token === 'ExpoPushToken[unused]')?.lastUsedAt).toBe(10)
    db.close()
  })
})

describe('deleteExpoPushTokensForSessions', () => {
  it('deletes only matching sessions and keeps null-session rows', () => {
    const db = freshDb()
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[match]', sessionId: 'session-a', now: 1 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[other]', sessionId: 'session-b', now: 2 })
    upsertExpoPushToken(db, { userId: 'user-a', token: 'ExpoPushToken[null]', now: 3 })

    expect(deleteExpoPushTokensForSessions(db, [])).toBe(0)
    expect(deleteExpoPushTokensForSessions(db, ['session-a'])).toBe(1)
    expect(listExpoPushTokens(db, 'user-a').map((record) => record.token).sort()).toEqual([
      'ExpoPushToken[null]',
      'ExpoPushToken[other]',
    ])
    db.close()
  })
})

describe('expo push receipts', () => {
  it('ignores duplicate receipts', () => {
    const db = freshDb()
    insertExpoPushReceipts(db, [{ receiptId: 'receipt-1', token: 'ExpoPushToken[a]', checkAfter: 100 }], 10)
    insertExpoPushReceipts(db, [{ receiptId: 'receipt-1', token: 'ExpoPushToken[a]', checkAfter: 999 }], 20)

    expect(db.prepare('SELECT receipt_id, check_after, created_at FROM expo_push_receipts').all()).toEqual([
      { receipt_id: 'receipt-1', check_after: 100, created_at: 10 },
    ])
    db.close()
  })

  it('lists only due receipts in ascending order and respects the limit', () => {
    const db = freshDb()
    insertExpoPushReceipts(
      db,
      [
        { receiptId: 'receipt-late', token: 'ExpoPushToken[a]', checkAfter: 300 },
        { receiptId: 'receipt-early', token: 'ExpoPushToken[b]', checkAfter: 100 },
        { receiptId: 'receipt-middle', token: 'ExpoPushToken[c]', checkAfter: 200 },
        { receiptId: 'receipt-future', token: 'ExpoPushToken[d]', checkAfter: 900 },
      ],
      10,
    )

    expect(listDueExpoPushReceipts(db, 250, 10)).toEqual([
      { receiptId: 'receipt-early', token: 'ExpoPushToken[b]' },
      { receiptId: 'receipt-middle', token: 'ExpoPushToken[c]' },
    ])
    expect(listDueExpoPushReceipts(db, 250, 1)).toEqual([{ receiptId: 'receipt-early', token: 'ExpoPushToken[b]' }])
    db.close()
  })

  it('deletes checked receipts by id and expired receipts by age', () => {
    const db = freshDb()
    insertExpoPushReceipts(
      db,
      [
        { receiptId: 'receipt-old', token: 'ExpoPushToken[a]', checkAfter: 100 },
        { receiptId: 'receipt-new', token: 'ExpoPushToken[b]', checkAfter: 100 },
      ],
      10,
    )

    deleteExpoPushReceipts(db, [])
    deleteExpoPushReceipts(db, ['receipt-old'])
    expect(db.prepare('SELECT receipt_id FROM expo_push_receipts').all()).toEqual([{ receipt_id: 'receipt-new' }])

    insertExpoPushReceipts(db, [{ receiptId: 'receipt-fresh', token: 'ExpoPushToken[c]', checkAfter: 100 }], 500)
    expect(deleteExpoPushReceiptsCreatedBefore(db, 100)).toBe(1)
    expect(db.prepare('SELECT receipt_id FROM expo_push_receipts').all()).toEqual([{ receipt_id: 'receipt-fresh' }])
    db.close()
  })
})

describe('ExpoPushTokenRequestSchema', () => {
  it('accepts Expo and Exponent token formats and rejects arbitrary strings', () => {
    expect(ExpoPushTokenRequestSchema.safeParse({ token: 'ExponentPushToken[abc]' }).success).toBe(true)
    expect(ExpoPushTokenRequestSchema.safeParse({ token: 'ExpoPushToken[abc]' }).success).toBe(true)
    expect(ExpoPushTokenRequestSchema.safeParse({ token: 'abc' }).success).toBe(false)
  })
})
