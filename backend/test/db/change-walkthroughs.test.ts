import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import type { ChangeWalkthrough } from '@opencode-manager/shared/schemas'
import {
  deleteChangeWalkthroughs,
  ensureChangeWalkthroughTable,
  getChangeWalkthrough,
  saveChangeWalkthrough,
} from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration202610081200 from '../../src/db/migrations/202610081200-change-walkthrough-sources'

const SESSION_ID = 'ses_walkthrough'
const SESSION_SOURCE = 'session'
const STAGED_SOURCE = 'staged'

function walkthrough(overrides: Partial<ChangeWalkthrough> = {}): ChangeWalkthrough {
  return {
    sessionId: SESSION_ID,
    source: { kind: 'session' },
    diffHash: 'hash-1',
    model: null,
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

function tableColumns(db: Database): string[] {
  return (db.prepare('PRAGMA table_info(change_walkthroughs)').all() as Array<{ name: string }>).map(
    (column) => column.name,
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

  it('creates the change_walkthroughs table with per-source storage', () => {
    expect(walkthroughTableExists(db)).toBe(true)
    expect(tableColumns(db)).toContain('source_key')
  })

  it('upgrades an existing single-source table and stays idempotent', () => {
    const legacy = new Database(':memory:')
    try {
      ensureChangeWalkthroughTable(legacy)

      migrate(legacy, allMigrations)
      expect(tableColumns(legacy)).toContain('source_key')

      expect(() => migrate(legacy, allMigrations)).not.toThrow()
      expect(() => migration202610081200.up(legacy)).not.toThrow()
      expect(tableColumns(legacy)).toContain('source_key')
    } finally {
      legacy.close()
    }
  })

  it('creates the old table idempotently', () => {
    expect(() => ensureChangeWalkthroughTable(db)).not.toThrow()
    expect(walkthroughTableExists(db)).toBe(true)
  })

  it('returns null for a session without a stored walkthrough', () => {
    expect(getChangeWalkthrough(db, 'ses_missing', SESSION_SOURCE)).toBeNull()
  })

  it('round-trips a stored walkthrough', () => {
    const stored = walkthrough()
    saveChangeWalkthrough(db, stored)

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toEqual(stored)
  })

  it('stores walkthroughs for two sources of one session side by side', () => {
    saveChangeWalkthrough(db, walkthrough({ diffHash: 'hash-session' }))
    saveChangeWalkthrough(db, walkthrough({ source: { kind: 'staged' }, diffHash: 'hash-staged', summary: 'Staged' }))

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)?.diffHash).toBe('hash-session')
    expect(getChangeWalkthrough(db, SESSION_ID, STAGED_SOURCE)?.diffHash).toBe('hash-staged')
  })

  it('keeps a single row holding the latest payload on repeated saves of one source', () => {
    saveChangeWalkthrough(db, walkthrough())
    saveChangeWalkthrough(db, walkthrough({ diffHash: 'hash-2', summary: 'Updated', createdAt: 2_000 }))

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM change_walkthroughs WHERE session_id = ?')
      .get(SESSION_ID) as { count: number }
    expect(count.count).toBe(1)

    const stored = getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)
    expect(stored).toMatchObject({ diffHash: 'hash-2', summary: 'Updated', createdAt: 2_000 })
  })

  it('deletes every source of the given session', () => {
    saveChangeWalkthrough(db, walkthrough())
    saveChangeWalkthrough(db, walkthrough({ source: { kind: 'staged' } }))
    saveChangeWalkthrough(db, walkthrough({ sessionId: 'ses_other' }))

    deleteChangeWalkthroughs(db, SESSION_ID)

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toBeNull()
    expect(getChangeWalkthrough(db, SESSION_ID, STAGED_SOURCE)).toBeNull()
    expect(getChangeWalkthrough(db, 'ses_other', SESSION_SOURCE)).not.toBeNull()
  })

  it('ignores deleting a session without a stored walkthrough', () => {
    expect(() => deleteChangeWalkthroughs(db, 'ses_missing')).not.toThrow()
  })

  it('treats a corrupt payload as missing', () => {
    db.prepare(
      'INSERT INTO change_walkthroughs(session_id, source_key, diff_hash, payload, created_at) VALUES(?,?,?,?,?)',
    ).run(SESSION_ID, SESSION_SOURCE, 'hash-1', '{not json', 1_000)

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toBeNull()
  })

  it('treats a payload that fails schema validation as missing', () => {
    db.prepare(
      'INSERT INTO change_walkthroughs(session_id, source_key, diff_hash, payload, created_at) VALUES(?,?,?,?,?)',
    ).run(SESSION_ID, SESSION_SOURCE, 'hash-1', JSON.stringify({ sessionId: SESSION_ID }), 1_000)

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toBeNull()
  })
})
