import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { WALKTHROUGH_GENERATION_TIMEOUT_MS } from '@opencode-manager/shared/schemas'
import {
  claimChangeWalkthroughGeneration,
  deleteChangeWalkthroughs,
  ensureChangeWalkthroughTable,
  getChangeWalkthrough,
  getChangeWalkthroughByWalkthroughSession,
  listChangeWalkthroughs,
  updateChangeWalkthrough,
  type ClaimChangeWalkthroughGenerationInput,
} from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration202610151200 from '../../src/db/migrations/202610151200-change-walkthrough-sessions'
import migration202610161200 from '../../src/db/migrations/202610161200-change-walkthrough-execution'

const SESSION_ID = 'ses_walkthrough'
const SESSION_SOURCE = 'session'
const STAGED_SOURCE = 'staged'
const NOW = 10_000_000

function claim(
  overrides: Partial<ClaimChangeWalkthroughGenerationInput> = {},
): ClaimChangeWalkthroughGenerationInput {
  return {
    sessionId: SESSION_ID,
    source: { kind: 'session' },
    diffHash: 'hash-1',
    generationId: 'gen-1',
    artifactPath: '/workspace/walkthroughs/ses_walkthrough/gen-1/index.html',
    model: 'anthropic/claude',
    now: NOW,
    ...overrides,
  }
}

function insertRow(db: Database, sourceKey: string): void {
  db.prepare(`
    INSERT INTO change_walkthroughs(
      session_id, source_key, diff_hash, generation_id, walkthrough_session_id, status,
      artifact_path, published_at, error, model, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(SESSION_ID, sourceKey, 'hash-1', 'gen-1', null, 'generating', null, null, null, null, NOW, NOW)
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

  it('creates the sessions table with the expected columns, primary key, and index', () => {
    const columns = db.prepare('PRAGMA table_info(change_walkthroughs)').all() as Array<{
      name: string
      pk: number
    }>
    const names = columns.map((column) => column.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'generation_id',
        'walkthrough_session_id',
        'status',
        'artifact_path',
        'published_at',
        'error',
        'model',
        'updated_at',
        'execution_started_at',
      ]),
    )

    const primaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name)
    expect(primaryKey).toEqual(['session_id', 'source_key'])

    const indexes = db.prepare('PRAGMA index_list(change_walkthroughs)').all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('change_walkthroughs_walkthrough_session')
  })

  it('applies the migration up idempotently', () => {
    expect(() => migration202610151200.up(db)).not.toThrow()
  })

  it('adds the execution_started_at column idempotently', () => {
    const columns = db.prepare('PRAGMA table_info(change_walkthroughs)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('execution_started_at')

    expect(() => migration202610161200.up(db)).not.toThrow()
  })

  it('claims a generation on a fresh row', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)

    const stored = getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)
    expect(stored).toMatchObject({
      sessionId: SESSION_ID,
      source: { kind: 'session' },
      diffHash: 'hash-1',
      status: 'generating',
      walkthroughSessionId: null,
      publishedAt: null,
      executionStartedAt: null,
      error: null,
      model: 'anthropic/claude',
      artifactPath: '/workspace/walkthroughs/ses_walkthrough/gen-1/index.html',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('rejects a second claim while a fresh generation is in progress', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    expect(claimChangeWalkthroughGeneration(db, claim({ generationId: 'gen-2', now: NOW + 1 }))).toBe(false)
  })

  it.each(['ready', 'failed', 'cancelled'] as const)('reclaims a row whose status is %s', (status) => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {
      status,
      walkthroughSessionId: 'ses_generated',
      publishedAt: NOW + 5,
      error: status === 'failed' ? { message: 'boom' } : null,
      updatedAt: NOW + 10,
    })

    expect(
      claimChangeWalkthroughGeneration(
        db,
        claim({
          generationId: 'gen-2',
          diffHash: 'hash-2',
          artifactPath: '/workspace/walkthroughs/ses_walkthrough/gen-2/index.html',
          now: NOW + 20,
        }),
      ),
    ).toBe(true)

    const stored = getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)
    expect(stored).toMatchObject({
      status: 'generating',
      diffHash: 'hash-2',
      artifactPath: '/workspace/walkthroughs/ses_walkthrough/gen-2/index.html',
      walkthroughSessionId: null,
      publishedAt: null,
      executionStartedAt: null,
      error: null,
      createdAt: NOW,
      updatedAt: NOW + 20,
    })
  })

  it('rejects a stale claim within the timeout but allows one after it', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    expect(
      claimChangeWalkthroughGeneration(
        db,
        claim({ generationId: 'gen-2', now: NOW + WALKTHROUGH_GENERATION_TIMEOUT_MS }),
      ),
    ).toBe(false)
    expect(
      claimChangeWalkthroughGeneration(
        db,
        claim({ generationId: 'gen-3', now: NOW + WALKTHROUGH_GENERATION_TIMEOUT_MS + 1 }),
      ),
    ).toBe(true)
  })

  it('stores both sources of one session as separate rows', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    expect(
      claimChangeWalkthroughGeneration(db, claim({ source: { kind: 'staged' }, diffHash: 'hash-2' })),
    ).toBe(true)

    const list = listChangeWalkthroughs(db, SESSION_ID)
    expect(list).toHaveLength(2)
    expect(list.map((walkthrough) => walkthrough.source.kind).sort()).toEqual(['session', 'staged'])
  })

  it('returns null for an unknown session or source', () => {
    expect(getChangeWalkthrough(db, 'ses_missing', SESSION_SOURCE)).toBeNull()
  })

  it('returns null when the stored source key is unparseable', () => {
    insertRow(db, 'bogus')
    expect(getChangeWalkthrough(db, SESSION_ID, 'bogus')).toBeNull()
  })

  it('finds a walkthrough by its generation session id', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {
      walkthroughSessionId: 'ses_generated',
      updatedAt: NOW + 1,
    })

    const found = getChangeWalkthroughByWalkthroughSession(db, 'ses_generated')
    expect(found?.generationId).toBe('gen-1')
    expect(found?.walkthrough.source.kind).toBe('session')

    expect(getChangeWalkthroughByWalkthroughSession(db, 'ses_unknown')).toBeNull()
  })

  it('does not update a row whose status is not expected', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)

    expect(
      updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['ready'], {
        status: 'ready',
        updatedAt: NOW + 1,
      }),
    ).toBeNull()
    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)?.status).toBe('generating')
  })

  it('updates only while the walkthrough session id matches the guard', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {
      walkthroughSessionId: 'ses_a',
      updatedAt: NOW + 1,
    })

    expect(
      updateChangeWalkthrough(
        db,
        SESSION_ID,
        SESSION_SOURCE,
        ['generating'],
        { status: 'ready', updatedAt: NOW + 2 },
        { walkthroughSessionId: 'ses_b' },
      ),
    ).toBeNull()
    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toMatchObject({
      status: 'generating',
      walkthroughSessionId: 'ses_a',
    })

    expect(
      updateChangeWalkthrough(
        db,
        SESSION_ID,
        SESSION_SOURCE,
        ['generating'],
        { status: 'ready', updatedAt: NOW + 3 },
        { walkthroughSessionId: 'ses_a' },
      )?.status,
    ).toBe('ready')
  })

  it('guards updates by whether an execution is running', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {
      walkthroughSessionId: 'ses_a',
      executionStartedAt: NOW + 1,
      updatedAt: NOW + 1,
    })

    expect(
      updateChangeWalkthrough(
        db,
        SESSION_ID,
        SESSION_SOURCE,
        ['generating'],
        { status: 'ready', updatedAt: NOW + 2 },
        { running: false },
      ),
    ).toBeNull()

    expect(
      updateChangeWalkthrough(
        db,
        SESSION_ID,
        SESSION_SOURCE,
        ['generating'],
        { status: 'ready', executionStartedAt: null, updatedAt: NOW + 3 },
        { running: true },
      ),
    ).toMatchObject({ status: 'ready', executionStartedAt: null })
  })

  it('updates a row whose status matches and persists the patch', () => {    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)

    const failed = updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {
      status: 'failed',
      error: { message: 'boom', code: 'E_FAIL' },
      updatedAt: NOW + 1,
    })
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toEqual({ message: 'boom', code: 'E_FAIL' })
    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)?.error).toEqual({
      message: 'boom',
      code: 'E_FAIL',
    })

    const cleared = updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['failed'], {
      error: null,
      updatedAt: NOW + 2,
    })
    expect(cleared?.error).toBeNull()
    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)?.error).toBeNull()
  })

  it('returns null when there is nothing to update', () => {
    expect(claimChangeWalkthroughGeneration(db, claim())).toBe(true)
    expect(updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, ['generating'], {})).toBeNull()
    expect(updateChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE, [], { status: 'ready' })).toBeNull()
  })

  it('deletes every source of one session but not another', () => {
    claimChangeWalkthroughGeneration(db, claim())
    claimChangeWalkthroughGeneration(db, claim({ source: { kind: 'staged' } }))
    claimChangeWalkthroughGeneration(db, claim({ sessionId: 'ses_other' }))

    deleteChangeWalkthroughs(db, SESSION_ID)

    expect(getChangeWalkthrough(db, SESSION_ID, SESSION_SOURCE)).toBeNull()
    expect(getChangeWalkthrough(db, SESSION_ID, STAGED_SOURCE)).toBeNull()
    expect(getChangeWalkthrough(db, 'ses_other', SESSION_SOURCE)).not.toBeNull()
  })

  it('creates the table idempotently', () => {
    expect(() => ensureChangeWalkthroughTable(db)).not.toThrow()
    expect(() => ensureChangeWalkthroughTable(db)).not.toThrow()
  })
})
