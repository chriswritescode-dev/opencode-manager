import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  deleteSessionSandboxMode,
  getSessionSandboxMode,
  insertSessionSandboxModeIfAbsent,
  setSessionSandboxResources,
  setSessionSandboxed,
} from '../../src/db/session-sandbox-modes'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('session sandbox modes db', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('returns null for a session with no stored row', () => {
    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('stores and reads back the sandbox flag with a default source', () => {
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: true, source: 'default', resources: null })

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: true,
      source: 'default',
      resources: null,
    })
  })

  it('records the user source when the sandbox flag is set explicitly', () => {
    setSessionSandboxed(db, 'ses_root', false)

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: false,
      source: 'user',
      resources: null,
    })
  })

  it('inserts only when no row exists', () => {
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: true, source: 'default', resources: null })
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: false, source: 'user', resources: null })

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({ sandboxed: true, source: 'default' })
  })

  it('round-trips resources and keeps toggled_at stable across resource updates', () => {
    setSessionSandboxed(db, 'ses_root', true)
    const toggledAt = getSessionSandboxMode(db, 'ses_root')?.toggledAt

    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, true)

    const row = getSessionSandboxMode(db, 'ses_root')
    expect(row).toMatchObject({
      sandboxed: true,
      source: 'user',
      resources: { cpus: 4, memoryMib: 8192 },
    })
    expect(row?.toggledAt).toBe(toggledAt)

    setSessionSandboxResources(db, 'ses_root', { cpus: 8, memoryMib: 16384 }, true)
    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      resources: { cpus: 8, memoryMib: 16384 },
      toggledAt,
    })
  })

  it('inserts a default-sourced row when resources are set before the flag', () => {
    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, true)

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: true,
      source: 'default',
      resources: { cpus: 4, memoryMib: 8192 },
    })
  })

  it('clears resources without changing the sandbox flag or source', () => {
    setSessionSandboxed(db, 'ses_root', false)
    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, false)
    const toggledAt = getSessionSandboxMode(db, 'ses_root')?.toggledAt

    setSessionSandboxResources(db, 'ses_root', null, false)

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: false,
      source: 'user',
      resources: null,
      toggledAt,
    })
  })

  it('updates toggled_at when the sandbox flag changes', () => {
    setSessionSandboxed(db, 'ses_root', true)
    const first = getSessionSandboxMode(db, 'ses_root')?.toggledAt ?? 0

    setSessionSandboxed(db, 'ses_root', false)

    const second = getSessionSandboxMode(db, 'ses_root')?.toggledAt ?? 0
    expect(second).toBeGreaterThanOrEqual(first)
  })

  it('deletes a stored row', () => {
    setSessionSandboxed(db, 'ses_root', true)

    deleteSessionSandboxMode(db, 'ses_root')

    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })
})
