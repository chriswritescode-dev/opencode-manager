import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { FuseMultiRunRequestSchema } from '@opencode-manager/shared/schemas'
import {
  createMultiRunWithEntries,
  getMultiRun,
  getMultiRunFusionByRequest,
  insertMultiRunFusion,
  listMultiRuns,
  updateMultiRunFusion,
  type CreateMultiRunFusionInput,
} from '../../src/db/multi-runs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { deleteRepo } from '../../src/db/queries'

const REPO_ID = 7

function fusionInput(overrides: Partial<CreateMultiRunFusionInput> = {}): CreateMultiRunFusionInput {
  return {
    multiRunId: 0,
    requestId: 'req-1',
    model: 'openai/gpt-5',
    instructions: 'combine them',
    isolated: true,
    baseRef: 'main',
    sources: [
      { entryId: 1, sessionId: 'ses_a', model: 'openai/a', truncated: false },
      { entryId: 2, sessionId: 'ses_b', model: 'openai/b', truncated: true },
    ],
    ...overrides,
  }
}

function fusionTableExists(db: Database): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'multi_run_fusions'").get(),
  )
}

describe('multi-run fusions', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  function createRun(models = ['openai/a', 'openai/b']): number {
    const run = createMultiRunWithEntries(
      db,
      { repoId: REPO_ID, name: 'Sweep', prompt: 'go', isolated: true, baseRef: null },
      models,
    )
    return run.id
  }

  it('creates the multi_run_fusions table', () => {
    expect(fusionTableExists(db)).toBe(true)
  })

  it('keeps existing multi-run data when the fusions migration is applied', () => {
    const existing = new Database(':memory:')
    migrate(
      existing,
      allMigrations.filter((migration) => migration.id !== '202610061700-multi-run-fusions'),
    )
    existing
      .prepare('INSERT INTO multi_runs(repo_id, name, prompt, isolated, base_ref, created_at) VALUES(?,?,?,?,?,?)')
      .run(REPO_ID, 'Sweep', 'go', 1, null, 1)
    const multiRunId = Number(
      (existing.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id,
    )
    const insertEntry = existing.prepare(
      'INSERT INTO multi_run_entries(multi_run_id, model, status, session_id, directory, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    insertEntry.run(multiRunId, 'openai/a', 'started', 'ses_a', null, null, 1, 1)
    insertEntry.run(multiRunId, 'openai/b', 'started', 'ses_b', null, null, 1, 1)

    migrate(existing, allMigrations)

    const reloaded = getMultiRun(existing, multiRunId)
    expect(reloaded?.entries.map((entry) => entry.model)).toEqual(['openai/a', 'openai/b'])
    expect(reloaded?.fusions).toEqual([])
    expect(fusionTableExists(existing)).toBe(true)
    existing.close()
  })

  it('inserts a fusion once per request id and replays the stored record', () => {
    const multiRunId = createRun()
    const first = insertMultiRunFusion(db, fusionInput({ multiRunId }))
    const second = insertMultiRunFusion(db, fusionInput({ multiRunId, model: 'openai/other' }))

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.fusion.id).toBe(first.fusion.id)
    expect(second.fusion.model).toBe('openai/gpt-5')

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM multi_run_fusions WHERE multi_run_id = ?')
      .get(multiRunId) as { count: number }
    expect(count.count).toBe(1)
  })

  it('rolls back the insert when the stored sources fail readback validation', () => {
    const multiRunId = createRun()

    expect(() =>
      insertMultiRunFusion(
        db,
        fusionInput({
          multiRunId,
          sources: [{ entryId: 1.5, sessionId: 'ses_a', model: 'openai/a', truncated: false }],
        }),
      ),
    ).toThrow()

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM multi_run_fusions WHERE multi_run_id = ?')
      .get(multiRunId) as { count: number }
    expect(count.count).toBe(0)
    expect(getMultiRun(db, multiRunId)?.fusions).toEqual([])
  })

  it('stores parsed sources and the starting status of a new fusion', () => {
    const multiRunId = createRun()
    const { fusion } = insertMultiRunFusion(db, fusionInput({ multiRunId }))

    expect(fusion).toMatchObject({ multiRunId, requestId: 'req-1', status: 'starting', isolated: true })
    expect(fusion.sources).toEqual([
      { entryId: 1, sessionId: 'ses_a', model: 'openai/a', truncated: false },
      { entryId: 2, sessionId: 'ses_b', model: 'openai/b', truncated: true },
    ])
  })

  it('guards updates by the current status', () => {
    const multiRunId = createRun()
    const { fusion } = insertMultiRunFusion(db, fusionInput({ multiRunId }))

    const started = updateMultiRunFusion(db, fusion.id, ['starting'], {
      status: 'started',
      sessionId: 'ses_new',
      directory: '/worktrees/fusion',
    })
    expect(started).toMatchObject({ status: 'started', sessionId: 'ses_new', directory: '/worktrees/fusion' })

    expect(updateMultiRunFusion(db, fusion.id, ['starting'], { status: 'failed', error: 'late' })).toBeNull()

    const failed = updateMultiRunFusion(db, fusion.id, ['started'], { status: 'failed', error: 'boom' })
    expect(failed).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('includes fusions with parsed sources on getMultiRun and listMultiRuns', () => {
    const multiRunId = createRun()
    insertMultiRunFusion(db, fusionInput({ multiRunId }))

    const fetched = getMultiRun(db, multiRunId)
    expect(fetched?.fusions).toHaveLength(1)
    expect(fetched?.fusions[0]?.sources[0]).toEqual({
      entryId: 1,
      sessionId: 'ses_a',
      model: 'openai/a',
      truncated: false,
    })

    const listed = listMultiRuns(db, REPO_ID, 20)
    expect(listed[0]?.fusions).toHaveLength(1)
    expect(listed[0]?.fusions[0]?.sources).toHaveLength(2)
  })

  it('returns an empty fusion list for runs without fusions', () => {
    const multiRunId = createRun()
    expect(getMultiRun(db, multiRunId)?.fusions).toEqual([])
    expect(listMultiRuns(db, REPO_ID, 20)[0]?.fusions).toEqual([])
  })

  it('reads a fusion by its request id', () => {
    const multiRunId = createRun()
    const { fusion } = insertMultiRunFusion(db, fusionInput({ multiRunId }))

    expect(getMultiRunFusionByRequest(db, multiRunId, 'req-1')?.id).toBe(fusion.id)
    expect(getMultiRunFusionByRequest(db, multiRunId, 'missing')).toBeNull()
    expect(getMultiRunFusionByRequest(db, multiRunId + 1, 'req-1')).toBeNull()
  })

  it('removes fusions when the repository is deleted', () => {
    const multiRunId = createRun()
    insertMultiRunFusion(db, fusionInput({ multiRunId }))

    deleteRepo(db, REPO_ID)

    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_run_fusions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_run_entries').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_runs').get()).toEqual({ count: 0 })
  })
})

describe('FuseMultiRunRequestSchema', () => {
  const valid = {
    requestId: '00000000-0000-4000-8000-000000000000',
    entryIds: [1, 2],
    model: 'openai/gpt-5',
    isolate: true,
  }

  it('accepts at least two unique entry ids', () => {
    expect(FuseMultiRunRequestSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects fewer than two entry ids', () => {
    expect(FuseMultiRunRequestSchema.safeParse({ ...valid, entryIds: [1] }).success).toBe(false)
  })

  it('rejects duplicate entry ids', () => {
    expect(FuseMultiRunRequestSchema.safeParse({ ...valid, entryIds: [1, 1] }).success).toBe(false)
  })

  it('rejects a non-uuid request id', () => {
    expect(FuseMultiRunRequestSchema.safeParse({ ...valid, requestId: 'req-1' }).success).toBe(false)
  })

  it('rejects instructions over the limit', () => {
    expect(FuseMultiRunRequestSchema.safeParse({ ...valid, instructions: 'x'.repeat(4001) }).success).toBe(false)
  })
})
