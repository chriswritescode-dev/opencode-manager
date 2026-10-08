import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import type { ChangeWalkthrough } from '@opencode-manager/shared/schemas'
import {
  deleteChangeWalkthrough,
  ensureChangeWalkthroughTable,
  getChangeWalkthrough,
  saveChangeWalkthrough,
} from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const SESSION_ID = 'ses_walkthrough'

function walkthrough(overrides: Partial<ChangeWalkthrough> = {}): ChangeWalkthrough {
  return {
    sessionId: SESSION_ID,
    diffHash: 'hash-1',
    summary: 'A short summary',
    stops: [
      { id: 's_1', title: 'First stop', explanation: 'Why it matters', hunkIds: ['h_1'], status: 'ready', explanationKey: null },
    ],
    hunks: [
      {
        id: 'h_1',
        file: 'src/app.ts',
        status: 'modified',
        header: '@@ -1,2 +1,2 @@',
        text: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;',
        truncated: false,
      },
    ],
    omittedFiles: [{ file: 'assets/logo.png', reason: 'binary' }],
    createdAt: 1_000,
    ...overrides,
  }
}

function walkthroughTableExists(db: Database): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'change_walkthroughs'").get(),
  )
}

describe('change walkthroughs', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  it('creates the change_walkthroughs table in migration 29', () => {
    expect(walkthroughTableExists(db)).toBe(true)
  })

  it('creates the table idempotently', () => {
    expect(() => ensureChangeWalkthroughTable(db)).not.toThrow()
    expect(walkthroughTableExists(db)).toBe(true)
  })

  it('returns null for a session without a stored walkthrough', () => {
    expect(getChangeWalkthrough(db, 'ses_missing')).toBeNull()
  })

  it('round-trips a stored walkthrough', () => {
    const stored = walkthrough()
    saveChangeWalkthrough(db, stored)

    expect(getChangeWalkthrough(db, SESSION_ID)).toEqual(stored)
  })

  it('keeps a single row holding the latest payload on repeated saves', () => {
    saveChangeWalkthrough(db, walkthrough())
    saveChangeWalkthrough(db, walkthrough({ diffHash: 'hash-2', summary: 'Updated', createdAt: 2_000 }))

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM change_walkthroughs WHERE session_id = ?')
      .get(SESSION_ID) as { count: number }
    expect(count.count).toBe(1)

    const stored = getChangeWalkthrough(db, SESSION_ID)
    expect(stored).toMatchObject({ diffHash: 'hash-2', summary: 'Updated', createdAt: 2_000 })
  })

  it('deletes only the walkthrough of the given session', () => {
    saveChangeWalkthrough(db, walkthrough())
    saveChangeWalkthrough(db, walkthrough({ sessionId: 'ses_other' }))

    deleteChangeWalkthrough(db, SESSION_ID)

    expect(getChangeWalkthrough(db, SESSION_ID)).toBeNull()
    expect(getChangeWalkthrough(db, 'ses_other')).not.toBeNull()
  })

  it('ignores deleting a session without a stored walkthrough', () => {
    expect(() => deleteChangeWalkthrough(db, 'ses_missing')).not.toThrow()
  })

  it('treats a corrupt payload as missing', () => {
    db.prepare('INSERT INTO change_walkthroughs(session_id, diff_hash, payload, created_at) VALUES(?,?,?,?)').run(
      SESSION_ID,
      'hash-1',
      '{not json',
      1_000,
    )

    expect(getChangeWalkthrough(db, SESSION_ID)).toBeNull()
  })

  it('treats a payload that fails schema validation as missing', () => {
    db.prepare('INSERT INTO change_walkthroughs(session_id, diff_hash, payload, created_at) VALUES(?,?,?,?)').run(
      SESSION_ID,
      'hash-1',
      JSON.stringify({ sessionId: SESSION_ID }),
      1_000,
    )

    expect(getChangeWalkthrough(db, SESSION_ID)).toBeNull()
  })
})
