import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  deleteSessionSandboxMode,
  getSessionSandboxMode,
  insertSessionSandboxModeIfAbsent,
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
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: true, source: 'default' })

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: true,
      source: 'default',
    })
  })

  it('records the user source when the sandbox flag is set explicitly', () => {
    setSessionSandboxed(db, 'ses_root', false)

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: false,
      source: 'user',
    })
  })

  it('inserts only when no row exists', () => {
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: true, source: 'default' })
    insertSessionSandboxModeIfAbsent(db, 'ses_root', { sandboxed: false, source: 'user' })

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({ sandboxed: true, source: 'default' })
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
