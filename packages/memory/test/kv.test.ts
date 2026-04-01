import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createKvQuery } from '../src/storage/kv-queries'
import { createKvService } from '../src/services/kv'

const TEST_DIR = '/tmp/opencode-manager-kv-test-' + Date.now()

function createTestDb(): Database {
  const db = new Database(`${TEST_DIR}-${Math.random().toString(36).slice(2)}.db`)
  db.run(`
    CREATE TABLE IF NOT EXISTS project_kv (
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_project_kv_expires_at ON project_kv(expires_at)`)
  return db
}

describe('createKvQuery', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test('set and get round-trip', () => {
    const queries = createKvQuery(db)
    const expiresAt = Date.now() + 86400000
    queries.set('project-1', 'test-key', '{"foo":"bar"}', expiresAt)
    const row = queries.get('project-1', 'test-key')
    expect(row).toBeDefined()
    expect(row!.data).toBe('{"foo":"bar"}')
    expect(row!.projectId).toBe('project-1')
    expect(row!.key).toBe('test-key')
  })

  test('get returns undefined for non-existent key', () => {
    const queries = createKvQuery(db)
    const row = queries.get('project-1', 'non-existent')
    expect(row).toBeUndefined()
  })

  test('get returns undefined for expired entry', async () => {
    const queries = createKvQuery(db)
    queries.set('project-1', 'expired-key', '"value"', Date.now() + 50)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const row = queries.get('project-1', 'expired-key')
    expect(row).toBeUndefined()
  })

  test('set upserts existing key', () => {
    const queries = createKvQuery(db)
    const expiresAt = Date.now() + 86400000
    queries.set('project-1', 'key1', '"value1"', expiresAt)
    queries.set('project-1', 'key1', '"value2"', expiresAt)
    const row = queries.get('project-1', 'key1')
    expect(row!.data).toBe('"value2"')
  })

  test('delete removes entry', () => {
    const queries = createKvQuery(db)
    queries.set('project-1', 'to-delete', '"value"', Date.now() + 86400000)
    queries.delete('project-1', 'to-delete')
    const row = queries.get('project-1', 'to-delete')
    expect(row).toBeUndefined()
  })

  test('list returns all non-expired entries for project', () => {
    const queries = createKvQuery(db)
    const expiresAt = Date.now() + 86400000
    queries.set('project-1', 'key1', '"value1"', expiresAt)
    queries.set('project-1', 'key2', '"value2"', expiresAt)
    queries.set('project-2', 'key3', '"value3"', expiresAt)
    const rows = queries.list('project-1')
    expect(rows.length).toBe(2)
  })

  test('list excludes expired entries', async () => {
    const queries = createKvQuery(db)
    queries.set('project-1', 'active', '"value"', Date.now() + 86400000)
    queries.set('project-1', 'expired', '"value"', Date.now() + 50)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const rows = queries.list('project-1')
    expect(rows.length).toBe(1)
    expect(rows[0]!.key).toBe('active')
  })

  test('deleteExpired cleans up expired entries', async () => {
    const queries = createKvQuery(db)
    queries.set('project-1', 'expired', '"value"', Date.now() + 50)
    queries.set('project-1', 'active', '"value"', Date.now() + 86400000)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const deleted = queries.deleteExpired()
    expect(deleted).toBe(1)
    expect(queries.get('project-1', 'active')).toBeDefined()
  })

  test('same key in different projects stores separate values', () => {
    const queries = createKvQuery(db)
    const expiresAt = Date.now() + 86400000
    queries.set('project-1', 'shared-key', '"value1"', expiresAt)
    queries.set('project-2', 'shared-key', '"value2"', expiresAt)
    expect(queries.get('project-1', 'shared-key')!.data).toBe('"value1"')
    expect(queries.get('project-2', 'shared-key')!.data).toBe('"value2"')
  })
})

describe('KvService', () => {
  let db: Database
  let service: ReturnType<typeof createKvService>

  beforeEach(() => {
    db = createTestDb()
    service = createKvService(db)
  })

  afterEach(() => {
    db.close()
  })

  test('set and get with JSON data', () => {
    service.set('project-1', 'test', { foo: 'bar', count: 42 })
    const result = service.get<{ foo: string; count: number }>('project-1', 'test')
    expect(result).toEqual({ foo: 'bar', count: 42 })
  })

  test('get returns null for non-existent key', () => {
    const result = service.get('project-1', 'non-existent')
    expect(result).toBeNull()
  })

  test('TTL expiration', async () => {
    service.set('project-1', 'ttl-key', 'value', 50)
    expect(service.get('project-1', 'ttl-key')).toBe('value')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(service.get('project-1', 'ttl-key')).toBeNull()
  })

  test('delete removes entry', () => {
    service.set('project-1', 'to-delete', 'value')
    service.delete('project-1', 'to-delete')
    expect(service.get('project-1', 'to-delete')).toBeNull()
  })

  test('list returns parsed entries', () => {
    service.set('project-1', 'key1', { a: 1 })
    service.set('project-1', 'key2', { b: 2 })
    const entries = service.list('project-1')
    expect(entries.length).toBe(2)
    expect(entries[0]!.key).toBeDefined()
    expect(entries[0]!.data).toBeDefined()
    expect(entries[0]!.updatedAt).toBeDefined()
    expect(entries[0]!.expiresAt).toBeDefined()
  })

  test('list returns empty array for project with no entries', () => {
    const entries = service.list('project-1')
    expect(entries.length).toBe(0)
  })

  test('different projectIds store separate state', () => {
    service.set('project-1', 'key', 'value1')
    service.set('project-2', 'key', 'value2')
    expect(service.get('project-1', 'key')).toBe('value1')
    expect(service.get('project-2', 'key')).toBe('value2')
  })

  test('complex JSON objects round-trip', () => {
    const complex = {
      patterns: ['pattern1', 'pattern2'],
      config: { nested: { deep: true } },
      count: 42,
    }
    service.set('project-1', 'complex', complex)
    const result = service.get('project-1', 'complex')
    expect(result).toEqual(complex)
  })

  test('list handles malformed JSON data gracefully', () => {
    const queries = createKvQuery(db)
    queries.set('project-1', 'valid', '{"a":1}', Date.now() + 86400000)
    queries.set('project-1', 'corrupt', '{invalid json', Date.now() + 86400000)
    const entries = service.list('project-1')
    expect(entries.length).toBe(2)
    const corrupt = entries.find((e) => e.key === 'corrupt')
    expect(corrupt!.data).toBeNull()
    const valid = entries.find((e) => e.key === 'valid')
    expect(valid!.data).toEqual({ a: 1 })
  })
})
