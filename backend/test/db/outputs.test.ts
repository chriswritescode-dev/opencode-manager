import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import {
  OUTPUT_GENERATION_TIMEOUT_MS,
  outputParamsKey,
  type OutputDefinitionInput,
  type OutputParams,
} from '@opencode-manager/shared/schemas'
import {
  claimOutputGeneration,
  deleteOutputDefinition,
  deleteSessionOutputDefinitions,
  deleteSessionOutputs,
  getOutput,
  getOutputByGeneratorSession,
  getOutputDefinitionRow,
  hasGeneratingOutput,
  insertOutputDefinition,
  listOutputDefinitionRows,
  listOutputGeneratorSessionIds,
  listOutputs,
  promoteSessionOutputDefinition,
  updateOutput,
  upsertOutputDefinition,
  upsertPublishedOutput,
  type ClaimOutputGenerationInput,
  type OutputRecordKey,
} from '../../src/db/outputs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration202611070000 from '../../src/db/migrations/202611070000-outputs'

const SESSION_ID = 'ses_outputs'
const OTHER_SESSION_ID = 'ses_other'
const DEFINITION_ID = 'report'
const NOW = 10_000_000
const DEFAULT_PARAMS: OutputParams = { scope: 'all' }

function definitionInput(overrides: Partial<OutputDefinitionInput> = {}): OutputDefinitionInput {
  return {
    id: DEFINITION_ID,
    label: 'Report',
    description: '',
    icon: 'FileText',
    params: [],
    instructions: 'Write a report.',
    dataSchema: { type: 'object', properties: { total: { type: 'number' } } },
    renderer: { kind: 'template', html: '<p>{{total}}</p>' },
    generation: 'separateSession',
    ...overrides,
  }
}

function claimInput(overrides: Partial<ClaimOutputGenerationInput> = {}): ClaimOutputGenerationInput {
  return {
    sessionId: SESSION_ID,
    definitionId: DEFINITION_ID,
    params: DEFAULT_PARAMS,
    inputHash: 'hash-1',
    generationId: 'gen-1',
    outputDir: '/workspace/outputs/ses_outputs/report/gen-1',
    model: 'anthropic/claude',
    now: NOW,
    ...overrides,
  }
}

function outputKey(params: OutputParams = DEFAULT_PARAMS): OutputRecordKey {
  return { sessionId: SESSION_ID, definitionId: DEFINITION_ID, paramsKey: outputParamsKey(params) }
}

function storedOutput(
  db: Database,
  sessionId: string = SESSION_ID,
  params: OutputParams = DEFAULT_PARAMS,
) {
  return getOutput(db, sessionId, DEFINITION_ID, outputParamsKey(params))
}

function primaryKey(columns: Array<{ name: string; pk: number }>): string[] {
  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)
}

describe('outputs', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  it('creates both tables with the expected columns, primary keys, and index', () => {
    const definitionColumns = db.prepare('PRAGMA table_info(output_definitions)').all() as Array<{
      name: string
      pk: number
    }>
    expect(definitionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['session_id', 'id', 'definition', 'created_at', 'updated_at']),
    )
    expect(primaryKey(definitionColumns)).toEqual(['session_id', 'id'])

    const outputColumns = db.prepare('PRAGMA table_info(outputs)').all() as Array<{
      name: string
      pk: number
    }>
    expect(outputColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'session_id',
        'definition_id',
        'params_key',
        'params',
        'input_hash',
        'generation_id',
        'generator_session_id',
        'status',
        'output_dir',
        'published_at',
        'execution_started_at',
        'error',
        'model',
        'created_at',
        'updated_at',
      ]),
    )
    expect(primaryKey(outputColumns)).toEqual(['session_id', 'definition_id', 'params_key'])

    const indexes = db.prepare('PRAGMA index_list(outputs)').all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('outputs_generator_session')
  })

  it('applies the migration up idempotently', () => {
    expect(() => migration202611070000.up(db)).not.toThrow()
    expect(() => migration202611070000.up(db)).not.toThrow()
  })

  it('claims generation on a fresh row', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)

    expect(storedOutput(db)).toMatchObject({
      sessionId: SESSION_ID,
      definitionId: DEFINITION_ID,
      paramsKey: outputParamsKey(DEFAULT_PARAMS),
      params: DEFAULT_PARAMS,
      inputHash: 'hash-1',
      generatorSessionId: null,
      status: 'generating',
      outputDir: '/workspace/outputs/ses_outputs/report/gen-1',
      publishedAt: null,
      executionStartedAt: null,
      error: null,
      model: 'anthropic/claude',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('rejects a second claim while a fresh generation is in progress', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(claimOutputGeneration(db, claimInput({ generationId: 'gen-2', now: NOW + 1 }))).toBe(false)
    expect(storedOutput(db)?.updatedAt).toBe(NOW)
  })

  it.each(['ready', 'failed', 'cancelled'] as const)('reclaims a row whose status is %s', (status) => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    updateOutput(db, outputKey(), ['generating'], {
      status,
      generatorSessionId: 'ses_generated',
      publishedAt: NOW + 5,
      executionStartedAt: NOW + 6,
      error: status === 'failed' ? { message: 'boom' } : null,
      updatedAt: NOW + 10,
    })

    expect(
      claimOutputGeneration(
        db,
        claimInput({
          generationId: 'gen-2',
          inputHash: 'hash-2',
          outputDir: '/workspace/outputs/ses_outputs/report/gen-2',
          model: 'openai/gpt',
          now: NOW + 20,
        }),
      ),
    ).toBe(true)

    expect(storedOutput(db)).toMatchObject({
      status: 'generating',
      inputHash: 'hash-2',
      generatorSessionId: null,
      publishedAt: null,
      executionStartedAt: null,
      error: null,
      model: 'openai/gpt',
      outputDir: '/workspace/outputs/ses_outputs/report/gen-2',
      createdAt: NOW,
      updatedAt: NOW + 20,
    })
  })

  it('rejects a stale claim at the timeout but allows one after it', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(
      claimOutputGeneration(
        db,
        claimInput({ generationId: 'gen-2', now: NOW + OUTPUT_GENERATION_TIMEOUT_MS }),
      ),
    ).toBe(false)
    expect(
      claimOutputGeneration(
        db,
        claimInput({ generationId: 'gen-3', now: NOW + OUTPUT_GENERATION_TIMEOUT_MS + 1 }),
      ),
    ).toBe(true)
  })

  it('stores different params as separate rows', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(
      claimOutputGeneration(
        db,
        claimInput({ params: { scope: 'changed' }, inputHash: 'hash-2', generationId: 'gen-2' }),
      ),
    ).toBe(true)

    const list = listOutputs(db, SESSION_ID)
    expect(list).toHaveLength(2)
    expect(list.map((output) => output.paramsKey).sort()).toEqual(
      [outputParamsKey(DEFAULT_PARAMS), outputParamsKey({ scope: 'changed' })].sort(),
    )
  })

  it('returns null for an unknown output', () => {
    expect(storedOutput(db)).toBeNull()
  })

  it('reports whether any output of a definition is generating', () => {
    expect(hasGeneratingOutput(db, DEFINITION_ID)).toBe(false)

    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(hasGeneratingOutput(db, DEFINITION_ID)).toBe(true)
    expect(hasGeneratingOutput(db, 'other')).toBe(false)

    updateOutput(db, outputKey(), ['generating'], { status: 'ready' })
    expect(hasGeneratingOutput(db, DEFINITION_ID)).toBe(false)
  })

  it('finds an output by its generator session id', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    updateOutput(db, outputKey(), ['generating'], {
      generatorSessionId: 'ses_generated',
      updatedAt: NOW + 1,
    })

    const found = getOutputByGeneratorSession(db, 'ses_generated')
    expect(found?.generationId).toBe('gen-1')
    expect(found?.output.definitionId).toBe(DEFINITION_ID)
    expect(found?.output.generatorSessionId).toBe('ses_generated')
    expect(listOutputGeneratorSessionIds(db)).toEqual(['ses_generated'])

    expect(getOutputByGeneratorSession(db, 'ses_unknown')).toBeNull()
  })

  it('upserts a published record and keeps created_at on the next publish', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)

    const published = upsertPublishedOutput(db, {
      sessionId: SESSION_ID,
      definitionId: DEFINITION_ID,
      params: DEFAULT_PARAMS,
      inputHash: 'hash-2',
      generationId: 'gen-2',
      generatorSessionId: 'ses_generated',
      outputDir: '/workspace/outputs/ses_outputs/report/gen-2',
      model: 'anthropic/claude',
      now: NOW + 10,
    })
    expect(published).toMatchObject({
      status: 'ready',
      inputHash: 'hash-2',
      generatorSessionId: 'ses_generated',
      publishedAt: NOW + 10,
      executionStartedAt: null,
      error: null,
      createdAt: NOW,
      updatedAt: NOW + 10,
    })

    const republished = upsertPublishedOutput(db, {
      sessionId: SESSION_ID,
      definitionId: DEFINITION_ID,
      params: DEFAULT_PARAMS,
      inputHash: 'hash-3',
      generationId: 'gen-3',
      generatorSessionId: null,
      outputDir: '/workspace/outputs/ses_outputs/report/gen-3',
      model: 'openai/gpt',
      now: NOW + 20,
    })
    expect(republished).toMatchObject({
      status: 'ready',
      inputHash: 'hash-3',
      generatorSessionId: null,
      publishedAt: NOW + 20,
      createdAt: NOW,
      updatedAt: NOW + 20,
    })
  })

  it('does not update a row whose status is not expected', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)

    expect(updateOutput(db, outputKey(), ['ready'], { status: 'ready', updatedAt: NOW + 1 })).toBeNull()
    expect(storedOutput(db)?.status).toBe('generating')
  })

  it('updates only while the generator session id matches the guard', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    updateOutput(db, outputKey(), ['generating'], {
      generatorSessionId: 'ses_a',
      updatedAt: NOW + 1,
    })

    expect(
      updateOutput(
        db,
        outputKey(),
        ['generating'],
        { status: 'ready', updatedAt: NOW + 2 },
        { generatorSessionId: 'ses_b' },
      ),
    ).toBeNull()
    expect(storedOutput(db)).toMatchObject({ status: 'generating', generatorSessionId: 'ses_a' })

    expect(
      updateOutput(
        db,
        outputKey(),
        ['generating'],
        { status: 'ready', updatedAt: NOW + 3 },
        { generatorSessionId: 'ses_a' },
      )?.status,
    ).toBe('ready')
  })

  it('guards updates by whether an execution is running', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    updateOutput(db, outputKey(), ['generating'], {
      generatorSessionId: 'ses_a',
      executionStartedAt: NOW + 1,
      updatedAt: NOW + 1,
    })

    expect(
      updateOutput(
        db,
        outputKey(),
        ['generating'],
        { status: 'ready', updatedAt: NOW + 2 },
        { running: false },
      ),
    ).toBeNull()

    expect(
      updateOutput(
        db,
        outputKey(),
        ['generating'],
        { status: 'ready', executionStartedAt: null, updatedAt: NOW + 3 },
        { running: true },
      ),
    ).toMatchObject({ status: 'ready', executionStartedAt: null })
  })

  it('persists and clears generation errors', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)

    const failed = updateOutput(db, outputKey(), ['generating'], {
      status: 'failed',
      error: { message: 'boom', code: 'E_FAIL' },
      updatedAt: NOW + 1,
    })
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toEqual({ message: 'boom', code: 'E_FAIL' })
    expect(storedOutput(db)?.error).toEqual({ message: 'boom', code: 'E_FAIL' })

    const cleared = updateOutput(db, outputKey(), ['failed'], { error: null, updatedAt: NOW + 2 })
    expect(cleared?.error).toBeNull()
    expect(storedOutput(db)?.error).toBeNull()
  })

  it('returns null when there is nothing to update', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(updateOutput(db, outputKey(), ['generating'], {})).toBeNull()
    expect(updateOutput(db, outputKey(), [], { status: 'ready' })).toBeNull()
  })

  it('lists and deletes only the outputs of the given session', () => {
    expect(claimOutputGeneration(db, claimInput())).toBe(true)
    expect(
      claimOutputGeneration(
        db,
        claimInput({ params: { scope: 'changed' }, inputHash: 'hash-2', generationId: 'gen-2' }),
      ),
    ).toBe(true)
    expect(claimOutputGeneration(db, claimInput({ sessionId: OTHER_SESSION_ID }))).toBe(true)

    expect(listOutputs(db, SESSION_ID)).toHaveLength(2)
    expect(listOutputs(db, OTHER_SESSION_ID)).toHaveLength(1)

    deleteSessionOutputs(db, SESSION_ID)

    expect(storedOutput(db)).toBeNull()
    expect(storedOutput(db, SESSION_ID, { scope: 'changed' })).toBeNull()
    expect(storedOutput(db, OTHER_SESSION_ID)).not.toBeNull()
  })

  it('keeps global and session definitions with the same id as separate rows', () => {
    upsertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ label: 'Global report' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Session report' }),
      now: NOW,
    })

    expect(getOutputDefinitionRow(db, '', DEFINITION_ID)).toMatchObject({
      label: 'Global report',
      origin: 'global',
    })
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)).toMatchObject({
      label: 'Session report',
      origin: 'session',
    })
  })

  it('lists globals alone without a session and globals plus the session with one', () => {
    insertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ id: 'first', label: 'Global first' }),
      now: NOW,
    })
    insertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ id: 'second', label: 'Session second' }),
      now: NOW,
    })

    expect(listOutputDefinitionRows(db).map((definition) => definition.id)).toEqual(['first'])
    expect(listOutputDefinitionRows(db, SESSION_ID).map((definition) => definition.id)).toEqual([
      'first',
      'second',
    ])
  })

  it('returns false when inserting a definition with a duplicate key', () => {
    expect(
      insertOutputDefinition(db, {
        sessionId: SESSION_ID,
        definition: definitionInput({ label: 'Original' }),
        now: NOW,
      }),
    ).toBe(true)
    expect(
      insertOutputDefinition(db, {
        sessionId: SESSION_ID,
        definition: definitionInput({ label: 'Duplicate' }),
        now: NOW + 1,
      }),
    ).toBe(false)
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)?.label).toBe('Original')
  })

  it('overwrites a definition when upserting', () => {
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Original' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Updated' }),
      now: NOW + 1,
    })

    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)?.label).toBe('Updated')
  })

  it('deletes scoped definitions without touching other scopes', () => {
    upsertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ label: 'Global' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Session' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ id: 'other', label: 'Session other' }),
      now: NOW,
    })

    deleteOutputDefinition(db, SESSION_ID, DEFINITION_ID)
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)).toBeNull()
    expect(getOutputDefinitionRow(db, '', DEFINITION_ID)).not.toBeNull()

    deleteSessionOutputDefinitions(db, SESSION_ID)
    expect(getOutputDefinitionRow(db, SESSION_ID, 'other')).toBeNull()
    expect(getOutputDefinitionRow(db, '', DEFINITION_ID)).not.toBeNull()
  })

  it('skips an unparseable stored definition', () => {
    db.prepare(`
      INSERT INTO output_definitions(session_id, id, definition, created_at, updated_at)
      VALUES('', 'broken', 'not json', ?, ?)
    `).run(NOW, NOW)
    insertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ id: 'valid' }),
      now: NOW,
    })

    expect(getOutputDefinitionRow(db, '', 'broken')).toBeNull()
    expect(listOutputDefinitionRows(db).map((definition) => definition.id)).toEqual(['valid'])
  })

  it('refuses to promote over an existing global without replace', () => {
    upsertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ label: 'Global' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Session' }),
      now: NOW,
    })

    expect(
      promoteSessionOutputDefinition(db, {
        sessionId: SESSION_ID,
        id: DEFINITION_ID,
        definition: definitionInput({ label: 'Promoted' }),
        now: NOW + 1,
      }),
    ).toBe(false)

    expect(getOutputDefinitionRow(db, '', DEFINITION_ID)?.label).toBe('Global')
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)?.label).toBe('Session')
  })

  it('promotes a session definition over an existing global with replace', () => {
    upsertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ label: 'Global' }),
      now: NOW,
    })
    upsertOutputDefinition(db, {
      sessionId: SESSION_ID,
      definition: definitionInput({ label: 'Session' }),
      now: NOW,
    })

    expect(
      promoteSessionOutputDefinition(db, {
        sessionId: SESSION_ID,
        id: DEFINITION_ID,
        definition: definitionInput({ label: 'Promoted' }),
        replace: true,
        now: NOW + 1,
      }),
    ).toBe(true)

    expect(getOutputDefinitionRow(db, '', DEFINITION_ID)).toMatchObject({
      label: 'Promoted',
      origin: 'global',
    })
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)).toBeNull()
  })
})
