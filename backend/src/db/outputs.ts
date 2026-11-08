import type { Database } from 'bun:sqlite'
import { isRecord } from '@opencode-manager/shared/utils'
import {
  OUTPUT_GENERATION_TIMEOUT_MS,
  OutputDefinitionSchema,
  OutputGenerationErrorSchema,
  OutputRecordSchema,
  outputParamsKey,
  type OutputDefinition,
  type OutputDefinitionInput,
  type OutputGenerationError,
  type OutputParams,
  type OutputRecord,
  type OutputStatus,
} from '@opencode-manager/shared/schemas'

interface OutputDefinitionRow {
  session_id: string
  id: string
  definition: string
  created_at: number
  updated_at: number
}

interface OutputRow {
  session_id: string
  definition_id: string
  params_key: string
  params: string
  input_hash: string | null
  generation_id: string
  generator_session_id: string | null
  status: string
  output_dir: string | null
  published_at: number | null
  execution_started_at: number | null
  error: string | null
  model: string | null
  created_at: number
  updated_at: number
}

const DEFINITION_COLUMNS = 'session_id, id, definition, created_at, updated_at'

const OUTPUT_COLUMNS = [
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
].join(', ')

export interface StoreOutputDefinitionInput {
  sessionId: string
  definition: OutputDefinitionInput
  now: number
}

export interface PromoteOutputDefinitionInput {
  sessionId: string
  id: string
  definition: OutputDefinitionInput
  replace?: boolean
  now: number
}

export interface ClaimOutputGenerationInput {
  sessionId: string
  definitionId: string
  params: OutputParams
  inputHash: string | null
  generationId: string
  outputDir: string
  model: string | null
  now: number
}

export interface UpsertPublishedOutputInput {
  sessionId: string
  definitionId: string
  params: OutputParams
  inputHash: string | null
  generationId: string
  generatorSessionId: string | null
  outputDir: string
  model: string | null
  now: number
}

export interface OutputRecordKey {
  sessionId: string
  definitionId: string
  paramsKey: string
}

export interface OutputRecordPatch {
  inputHash?: string | null
  generatorSessionId?: string | null
  status?: OutputStatus
  outputDir?: string | null
  publishedAt?: number | null
  executionStartedAt?: number | null
  error?: OutputGenerationError | null
  model?: string | null
  updatedAt?: number
}

export interface OutputUpdateOptions {
  generatorSessionId?: string
  running?: boolean
}

function parseStoredOutputError(raw: string | null): OutputGenerationError | null {
  if (raw === null) {
    return null
  }
  try {
    const parsed = OutputGenerationErrorSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function mapDefinitionRow(row: OutputDefinitionRow): OutputDefinition | null {
  try {
    const stored = JSON.parse(row.definition) as unknown
    if (!isRecord(stored)) {
      return null
    }
    const parsed = OutputDefinitionSchema.safeParse({
      ...stored,
      origin: row.session_id === '' ? 'global' : 'session',
    })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function mapOutputRow(row: OutputRow): OutputRecord | null {
  try {
    const parsed = OutputRecordSchema.safeParse({
      sessionId: row.session_id,
      definitionId: row.definition_id,
      paramsKey: row.params_key,
      params: JSON.parse(row.params) as unknown,
      inputHash: row.input_hash,
      generatorSessionId: row.generator_session_id,
      status: row.status,
      outputDir: row.output_dir,
      publishedAt: row.published_at,
      executionStartedAt: row.execution_started_at,
      error: parseStoredOutputError(row.error),
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function getOutputDefinitionRow(db: Database, sessionId: string, id: string): OutputDefinition | null {
  const row = db
    .prepare(`SELECT ${DEFINITION_COLUMNS} FROM output_definitions WHERE session_id = ? AND id = ?`)
    .get(sessionId, id) as OutputDefinitionRow | undefined
  return row ? mapDefinitionRow(row) : null
}

export function listOutputDefinitionRows(db: Database, sessionId?: string): OutputDefinition[] {
  const rows = (
    sessionId === undefined
      ? db
          .prepare(
            `SELECT ${DEFINITION_COLUMNS} FROM output_definitions WHERE session_id = '' ORDER BY created_at, id`,
          )
          .all()
      : db
          .prepare(
            `SELECT ${DEFINITION_COLUMNS} FROM output_definitions WHERE session_id IN ('', ?) ORDER BY created_at, id`,
          )
          .all(sessionId)
  ) as OutputDefinitionRow[]
  return rows.flatMap((row) => {
    const mapped = mapDefinitionRow(row)
    return mapped ? [mapped] : []
  })
}

export function insertOutputDefinition(db: Database, input: StoreOutputDefinitionInput): boolean {
  const result = db
    .prepare(`
      INSERT INTO output_definitions(session_id, id, definition, created_at, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(session_id, id) DO NOTHING
    `)
    .run(input.sessionId, input.definition.id, JSON.stringify(input.definition), input.now, input.now)
  return result.changes > 0
}

export function upsertOutputDefinition(db: Database, input: StoreOutputDefinitionInput): void {
  db.prepare(`
    INSERT INTO output_definitions(session_id, id, definition, created_at, updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(session_id, id) DO UPDATE SET
      definition = excluded.definition,
      updated_at = excluded.updated_at
  `).run(input.sessionId, input.definition.id, JSON.stringify(input.definition), input.now, input.now)
}

export function deleteOutputDefinition(db: Database, sessionId: string, id: string): void {
  db.prepare('DELETE FROM output_definitions WHERE session_id = ? AND id = ?').run(sessionId, id)
}

export function deleteSessionOutputDefinitions(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM output_definitions WHERE session_id = ?').run(sessionId)
}

export function promoteSessionOutputDefinition(db: Database, input: PromoteOutputDefinitionInput): boolean {
  return db.transaction(() => {
    const existingGlobal = db
      .prepare("SELECT 1 FROM output_definitions WHERE session_id = '' AND id = ?")
      .get(input.id)
    if (existingGlobal && input.replace !== true) {
      return false
    }
    upsertOutputDefinition(db, { sessionId: '', definition: input.definition, now: input.now })
    deleteOutputDefinition(db, input.sessionId, input.id)
    return true
  })()
}

export function claimOutputGeneration(db: Database, input: ClaimOutputGenerationInput): boolean {
  const result = db
    .prepare(`
      INSERT INTO outputs(
        session_id, definition_id, params_key, params, input_hash, generation_id, generator_session_id,
        status, output_dir, published_at, execution_started_at, error, model, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,NULL,'generating',?,NULL,NULL,NULL,?,?,?)
      ON CONFLICT(session_id, definition_id, params_key) DO UPDATE SET
        input_hash = excluded.input_hash,
        generation_id = excluded.generation_id,
        generator_session_id = NULL,
        status = 'generating',
        output_dir = excluded.output_dir,
        published_at = NULL,
        error = NULL,
        model = excluded.model,
        updated_at = excluded.updated_at,
        execution_started_at = NULL,
        params = excluded.params
      WHERE outputs.status != 'generating' OR outputs.updated_at < ?
    `)
    .run(
      input.sessionId,
      input.definitionId,
      outputParamsKey(input.params),
      JSON.stringify(input.params),
      input.inputHash,
      input.generationId,
      input.outputDir,
      input.model,
      input.now,
      input.now,
      input.now - OUTPUT_GENERATION_TIMEOUT_MS,
    )
  return result.changes > 0
}

export function upsertPublishedOutput(db: Database, input: UpsertPublishedOutputInput): OutputRecord | null {
  const paramsKey = outputParamsKey(input.params)
  db.prepare(`
    INSERT INTO outputs(
      session_id, definition_id, params_key, params, input_hash, generation_id, generator_session_id,
      status, output_dir, published_at, execution_started_at, error, model, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,'ready',?,?,NULL,NULL,?,?,?)
    ON CONFLICT(session_id, definition_id, params_key) DO UPDATE SET
      params = excluded.params,
      input_hash = excluded.input_hash,
      generation_id = excluded.generation_id,
      generator_session_id = excluded.generator_session_id,
      status = 'ready',
      output_dir = excluded.output_dir,
      published_at = excluded.published_at,
      execution_started_at = NULL,
      error = NULL,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run(
    input.sessionId,
    input.definitionId,
    paramsKey,
    JSON.stringify(input.params),
    input.inputHash,
    input.generationId,
    input.generatorSessionId,
    input.outputDir,
    input.now,
    input.model,
    input.now,
    input.now,
  )
  return getOutput(db, input.sessionId, input.definitionId, paramsKey)
}

export function getOutput(
  db: Database,
  sessionId: string,
  definitionId: string,
  paramsKey: string,
): OutputRecord | null {
  const row = db
    .prepare(
      `SELECT ${OUTPUT_COLUMNS} FROM outputs WHERE session_id = ? AND definition_id = ? AND params_key = ?`,
    )
    .get(sessionId, definitionId, paramsKey) as OutputRow | undefined
  return row ? mapOutputRow(row) : null
}

export function getOutputByGeneratorSession(
  db: Database,
  generatorSessionId: string,
): { output: OutputRecord; generationId: string } | null {
  const row = db
    .prepare(`SELECT ${OUTPUT_COLUMNS} FROM outputs WHERE generator_session_id = ?`)
    .get(generatorSessionId) as OutputRow | undefined
  if (!row) {
    return null
  }
  const output = mapOutputRow(row)
  if (!output) {
    return null
  }
  return { output, generationId: row.generation_id }
}

export function updateOutput(
  db: Database,
  key: OutputRecordKey,
  expectedStatuses: OutputStatus[],
  patch: OutputRecordPatch,
  options: OutputUpdateOptions = {},
): OutputRecord | null {
  const assignments: string[] = []
  const params: (string | number | null)[] = []

  if (patch.inputHash !== undefined) {
    assignments.push('input_hash = ?')
    params.push(patch.inputHash)
  }
  if (patch.generatorSessionId !== undefined) {
    assignments.push('generator_session_id = ?')
    params.push(patch.generatorSessionId)
  }
  if (patch.status !== undefined) {
    assignments.push('status = ?')
    params.push(patch.status)
  }
  if (patch.outputDir !== undefined) {
    assignments.push('output_dir = ?')
    params.push(patch.outputDir)
  }
  if (patch.publishedAt !== undefined) {
    assignments.push('published_at = ?')
    params.push(patch.publishedAt)
  }
  if (patch.executionStartedAt !== undefined) {
    assignments.push('execution_started_at = ?')
    params.push(patch.executionStartedAt)
  }
  if (patch.error !== undefined) {
    assignments.push('error = ?')
    params.push(patch.error === null ? null : JSON.stringify(patch.error))
  }
  if (patch.model !== undefined) {
    assignments.push('model = ?')
    params.push(patch.model)
  }
  if (patch.updatedAt !== undefined) {
    assignments.push('updated_at = ?')
    params.push(patch.updatedAt)
  }

  if (assignments.length === 0 || expectedStatuses.length === 0) {
    return null
  }

  const placeholders = expectedStatuses.map(() => '?').join(', ')
  const conditions = ['session_id = ?', 'definition_id = ?', 'params_key = ?', `status IN (${placeholders})`]
  const conditionParams: (string | number | null)[] = [
    key.sessionId,
    key.definitionId,
    key.paramsKey,
    ...expectedStatuses,
  ]
  if (options.generatorSessionId !== undefined) {
    conditions.push('generator_session_id = ?')
    conditionParams.push(options.generatorSessionId)
  }
  if (options.running !== undefined) {
    conditions.push(options.running ? 'execution_started_at IS NOT NULL' : 'execution_started_at IS NULL')
  }

  const result = db
    .prepare(`UPDATE outputs SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')}`)
    .run(...params, ...conditionParams)

  if (result.changes === 0) {
    return null
  }
  return getOutput(db, key.sessionId, key.definitionId, key.paramsKey)
}

export function listOutputs(db: Database, sessionId: string): OutputRecord[] {
  const rows = db
    .prepare(`SELECT ${OUTPUT_COLUMNS} FROM outputs WHERE session_id = ? ORDER BY created_at, definition_id, params_key`)
    .all(sessionId) as OutputRow[]
  return rows.flatMap((row) => {
    const mapped = mapOutputRow(row)
    return mapped ? [mapped] : []
  })
}

export function listOutputGeneratorSessionIds(db: Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT generator_session_id FROM outputs WHERE generator_session_id IS NOT NULL')
    .all() as Array<{ generator_session_id: string }>
  return rows.map((row) => row.generator_session_id)
}

/** Reports whether any stored output of the definition is still generating. */
export function hasGeneratingOutput(db: Database, definitionId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM outputs WHERE definition_id = ? AND status = 'generating' LIMIT 1")
    .get(definitionId)
  return row !== null && row !== undefined
}

export function deleteSessionOutputs(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM outputs WHERE session_id = ?').run(sessionId)
}
