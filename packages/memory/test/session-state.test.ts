import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createSessionStateQueries } from '../src/storage/session-state-queries'
import { SessionStateService } from '../src/services/session-state'
import type { PlanningState, PreCompactionSnapshot } from '../src/types'

const TEST_DIR = '/tmp/opencode-manager-session-state-test-' + Date.now()

describe('SessionStateService', () => {
  let db: Database
  let service: SessionStateService

  beforeEach(() => {
    db = new Database(`${TEST_DIR}-${Math.random().toString(36).slice(2)}.db`)
    db.run(`
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        data TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    service = new SessionStateService(db)
  })

  afterEach(() => {
    service.destroy()
    db.close()
  })

  test('set and get basic values', () => {
    service.set('test-key', 'project-1', { foo: 'bar' })
    const result = service.get<{ foo: string }>('test-key')
    expect(result).toEqual({ foo: 'bar' })
  })

  test('get returns null for non-existent key', () => {
    const result = service.get('non-existent')
    expect(result).toBeNull()
  })

  test('set with TTL expires correctly', async () => {
    service.set('ttl-key', 'project-1', 'value', 100)
    const resultBefore = service.get('ttl-key')
    expect(resultBefore).toBe('value')

    await new Promise(resolve => setTimeout(resolve, 150))

    const resultAfter = service.get('ttl-key')
    expect(resultAfter).toBeNull()
  })

  test('delete removes key', () => {
    service.set('to-delete', 'project-1', 'value')
    service.delete('to-delete')
    const result = service.get('to-delete')
    expect(result).toBeNull()
  })

  test('deleteByPrefix removes matching keys', () => {
    service.set('session:abc', 'project-1', 'value1')
    service.set('session:def', 'project-1', 'value2')
    service.set('other:key', 'project-1', 'value3')

    service.deleteByPrefix('session:*')

    expect(service.get('session:abc')).toBeNull()
    expect(service.get('session:def')).toBeNull()
    expect(service.get('other:key')).toBe('value3')
  })

  test('deleteExpired cleans up expired entries', async () => {
    const db2 = new Database(`${TEST_DIR}-expired-${Math.random().toString(36).slice(2)}.db`)
    db2.run(`
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        data TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    const service2 = new SessionStateService(db2)

    service2.set('expired', 'project-1', 'value', 50)
    service2.set('permanent', 'project-1', 'value')

    await new Promise(resolve => setTimeout(resolve, 60))

    const deleted = service2.deleteExpired()
    expect(deleted).toBe(1)
    expect(service2.get('expired')).toBeNull()
    expect(service2.get('permanent')).toBe('value')

    service2.destroy()
    db2.close()
  })

  test('listByProject returns all entries for project', () => {
    service.set('session:1', 'project-1', { data: '1' })
    service.set('session:2', 'project-1', { data: '2' })
    service.set('session:3', 'project-2', { data: '3' })

    const results = service.listByProject('project-1')
    expect(results.length).toBe(2)
  })

  test('JSON serialization round-trip for complex objects', () => {
    const planningState: PlanningState = {
      objective: 'Implement feature X',
      current: 'Writing tests',
      next: 'Deploy to production',
      phases: [
        { title: 'Setup', status: 'completed', notes: 'Done' },
        { title: 'Implementation', status: 'in_progress' },
        { title: 'Testing', status: 'pending' },
      ],
      findings: ['Found a bug', 'Performance issue'],
      errors: ['Memory leak in handler'],
      active: true,
    }

    service.set('planning:1', 'project-1', planningState)
    const result = service.get<PlanningState>('planning:1')

    expect(result).toEqual(planningState)
    expect(result?.phases?.length).toBe(3)
    expect(result?.findings?.length).toBe(2)
  })

  test('setPlanningState and getPlanningState convenience methods', () => {
    const planningState: PlanningState = {
      objective: 'Test objective',
      current: 'Phase 1',
    }

    service.setPlanningState('session-123', 'project-1', planningState)
    const result = service.getPlanningState('session-123')

    expect(result).toEqual(planningState)
  })

  test('setCompactionSnapshot and getCompactionSnapshot convenience methods', () => {
    const snapshot: PreCompactionSnapshot = {
      timestamp: '2024-01-01T00:00:00Z',
      sessionId: 'session-123',
      planningState: {
        objective: 'Test',
      },
      branch: 'main',
      activeFiles: ['src/index.ts', 'src/utils.ts'],
    }

    service.setCompactionSnapshot('session-123', 'project-1', snapshot)
    const result = service.getCompactionSnapshot('session-123')

    expect(result).toEqual(snapshot)
    expect(result?.branch).toBe('main')
    expect(result?.activeFiles?.length).toBe(2)
  })
})

describe('createSessionStateQueries', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(`${TEST_DIR}-queries-${Math.random().toString(36).slice(2)}.db`)
    db.run(`
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        data TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  test('set updates existing key', () => {
    const queries = createSessionStateQueries(db)

    queries.set('key1', 'project-1', 'value1', null)
    const first = queries.get('key1')
    expect(first?.data).toBe('value1')

    queries.set('key1', 'project-1', 'updated-value', null)
    const second = queries.get('key1')
    expect(second?.data).toBe('updated-value')
  })
})
