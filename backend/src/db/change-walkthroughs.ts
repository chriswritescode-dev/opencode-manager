import type { Database } from 'bun:sqlite'
import {
  ChangeWalkthroughSchema,
  WalkthroughGenerationErrorSchema,
  WALKTHROUGH_GENERATION_TIMEOUT_MS,
  parseWalkthroughSourceKey,
  walkthroughSourceKey,
  type ChangeWalkthrough,
  type WalkthroughGenerationError,
  type WalkthroughSource,
  type WalkthroughStatus,
} from '@opencode-manager/shared/schemas'

interface ChangeWalkthroughRow {
  session_id: string
  source_key: string
  diff_hash: string
  generation_id: string
  walkthrough_session_id: string | null
  status: string
  artifact_path: string | null
  published_at: number | null
  error: string | null
  model: string | null
  created_at: number
  updated_at: number
  execution_started_at: number | null
}

const ROW_COLUMNS = 'session_id, source_key, diff_hash, generation_id, walkthrough_session_id, status, artifact_path, published_at, error, model, created_at, updated_at, execution_started_at'

export interface ChangeWalkthroughPatch {
  walkthroughSessionId?: string | null
  status?: WalkthroughStatus
  publishedAt?: number | null
  executionStartedAt?: number | null
  error?: WalkthroughGenerationError | null
  updatedAt?: number
}

export interface ChangeWalkthroughUpdateOptions {
  walkthroughSessionId?: string
  running?: boolean
}

export interface ClaimChangeWalkthroughGenerationInput {
  sessionId: string
  source: WalkthroughSource
  diffHash: string
  generationId: string
  artifactPath: string
  model: string | null
  now: number
}

export function ensureChangeWalkthroughTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS change_walkthroughs (
      session_id TEXT PRIMARY KEY,
      diff_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

function parseStoredError(raw: string | null): WalkthroughGenerationError | null {
  if (raw === null) {
    return null
  }
  try {
    const parsed = WalkthroughGenerationErrorSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function mapRow(row: ChangeWalkthroughRow): ChangeWalkthrough | null {
  const source = parseWalkthroughSourceKey(row.source_key)
  if (!source) {
    return null
  }
  const parsed = ChangeWalkthroughSchema.safeParse({
    sessionId: row.session_id,
    source,
    diffHash: row.diff_hash,
    walkthroughSessionId: row.walkthrough_session_id,
    status: row.status,
    artifactPath: row.artifact_path,
    publishedAt: row.published_at,
    executionStartedAt: row.execution_started_at,
    error: parseStoredError(row.error),
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  return parsed.success ? parsed.data : null
}

export function getChangeWalkthrough(
  db: Database,
  sessionId: string,
  sourceKey: string,
): ChangeWalkthrough | null {
  const row = db
    .prepare(`SELECT ${ROW_COLUMNS} FROM change_walkthroughs WHERE session_id = ? AND source_key = ?`)
    .get(sessionId, sourceKey) as ChangeWalkthroughRow | undefined
  return row ? mapRow(row) : null
}

export function getChangeWalkthroughByWalkthroughSession(
  db: Database,
  walkthroughSessionId: string,
): { walkthrough: ChangeWalkthrough; generationId: string } | null {
  const row = db
    .prepare(`SELECT ${ROW_COLUMNS} FROM change_walkthroughs WHERE walkthrough_session_id = ?`)
    .get(walkthroughSessionId) as ChangeWalkthroughRow | undefined
  if (!row) {
    return null
  }
  const walkthrough = mapRow(row)
  if (!walkthrough) {
    return null
  }
  return { walkthrough, generationId: row.generation_id }
}

export function claimChangeWalkthroughGeneration(
  db: Database,
  input: ClaimChangeWalkthroughGenerationInput,
): boolean {
  const result = db.prepare(`
    INSERT INTO change_walkthroughs(
      session_id, source_key, diff_hash, generation_id, walkthrough_session_id, status,
      artifact_path, published_at, error, model, created_at, updated_at, execution_started_at
    ) VALUES(?,?,?,?,NULL,'generating',?,NULL,NULL,?,?,?,NULL)
    ON CONFLICT(session_id, source_key) DO UPDATE SET
      diff_hash = excluded.diff_hash,
      generation_id = excluded.generation_id,
      walkthrough_session_id = NULL,
      status = 'generating',
      artifact_path = excluded.artifact_path,
      published_at = NULL,
      error = NULL,
      model = excluded.model,
      updated_at = excluded.updated_at,
      execution_started_at = NULL
    WHERE change_walkthroughs.status != 'generating' OR change_walkthroughs.updated_at < ?
  `).run(
    input.sessionId,
    walkthroughSourceKey(input.source),
    input.diffHash,
    input.generationId,
    input.artifactPath,
    input.model,
    input.now,
    input.now,
    input.now - WALKTHROUGH_GENERATION_TIMEOUT_MS,
  )
  return result.changes > 0
}

export function updateChangeWalkthrough(
  db: Database,
  sessionId: string,
  sourceKey: string,
  expectedStatuses: WalkthroughStatus[],
  patch: ChangeWalkthroughPatch,
  options: ChangeWalkthroughUpdateOptions = {},
): ChangeWalkthrough | null {
  const assignments: string[] = []
  const params: (string | number | null)[] = []

  if (patch.walkthroughSessionId !== undefined) {
    assignments.push('walkthrough_session_id = ?')
    params.push(patch.walkthroughSessionId)
  }
  if (patch.status !== undefined) {
    assignments.push('status = ?')
    params.push(patch.status)
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
  if (patch.updatedAt !== undefined) {
    assignments.push('updated_at = ?')
    params.push(patch.updatedAt)
  }

  if (assignments.length === 0 || expectedStatuses.length === 0) {
    return null
  }

  const placeholders = expectedStatuses.map(() => '?').join(', ')
  const conditions = ['session_id = ?', 'source_key = ?', `status IN (${placeholders})`]
  const conditionParams: (string | number | null)[] = [sessionId, sourceKey, ...expectedStatuses]
  if (options.walkthroughSessionId !== undefined) {
    conditions.push('walkthrough_session_id = ?')
    conditionParams.push(options.walkthroughSessionId)
  }
  if (options.running !== undefined) {
    conditions.push(options.running ? 'execution_started_at IS NOT NULL' : 'execution_started_at IS NULL')
  }

  const result = db
    .prepare(`UPDATE change_walkthroughs SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')}`)
    .run(...params, ...conditionParams)

  if (result.changes === 0) {
    return null
  }
  return getChangeWalkthrough(db, sessionId, sourceKey)
}

export function listChangeWalkthroughSessionIds(db: Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT walkthrough_session_id FROM change_walkthroughs WHERE walkthrough_session_id IS NOT NULL')
    .all() as Array<{ walkthrough_session_id: string }>
  return rows.map((row) => row.walkthrough_session_id)
}

export function listChangeWalkthroughs(db: Database, sessionId: string): ChangeWalkthrough[] {
  const rows = db
    .prepare(`SELECT ${ROW_COLUMNS} FROM change_walkthroughs WHERE session_id = ?`)
    .all(sessionId) as ChangeWalkthroughRow[]
  return rows.flatMap((row) => {
    const mapped = mapRow(row)
    return mapped ? [mapped] : []
  })
}

export function deleteChangeWalkthroughs(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM change_walkthroughs WHERE session_id = ?').run(sessionId)
}
