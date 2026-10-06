import type { Database } from 'bun:sqlite'
import {
  MultiRunFusionSourceSchema,
  type MultiRunEntryStatus,
  type MultiRunFusionSource,
  type MultiRunFusionStatus,
} from '@opencode-manager/shared/schemas'

export interface MultiRunEntryRecord {
  id: number
  model: string
  status: MultiRunEntryStatus
  sessionId: string | null
  directory: string | null
  isolated: boolean
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface MultiRunFusionRecord {
  id: number
  multiRunId: number
  requestId: string
  model: string
  instructions: string | null
  isolated: boolean
  baseRef: string | null
  sources: MultiRunFusionSource[]
  status: MultiRunFusionStatus
  sessionId: string | null
  directory: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface MultiRunRecord {
  id: number
  repoId: number
  name: string
  prompt: string
  isolated: boolean
  baseRef: string | null
  createdAt: number
  entries: MultiRunEntryRecord[]
  fusions: MultiRunFusionRecord[]
}

export interface CreateMultiRunGroup {
  repoId: number
  name: string
  prompt: string
  isolated: boolean
  baseRef: string | null
}

export interface MultiRunEntryPatch {
  status?: MultiRunEntryStatus
  sessionId?: string | null
  directory?: string | null
  error?: string | null
}

export interface CreateMultiRunFusionInput {
  multiRunId: number
  requestId: string
  model: string
  instructions: string | null
  isolated: boolean
  baseRef: string | null
  sources: MultiRunFusionSource[]
}

export interface MultiRunFusionPatch {
  status?: MultiRunFusionStatus
  sessionId?: string | null
  directory?: string | null
  error?: string | null
}

interface MultiRunRow {
  id: number
  repo_id: number
  name: string
  prompt: string
  isolated: number
  base_ref: string | null
  created_at: number
}

interface MultiRunEntryRow {
  id: number
  multi_run_id: number
  model: string
  status: MultiRunEntryStatus
  session_id: string | null
  directory: string | null
  error: string | null
  created_at: number
  updated_at: number
}

interface MultiRunFusionRow {
  id: number
  multi_run_id: number
  request_id: string
  model: string
  instructions: string | null
  isolated: number
  base_ref: string | null
  sources: string
  status: MultiRunFusionStatus
  session_id: string | null
  directory: string | null
  error: string | null
  created_at: number
  updated_at: number
}

const MULTI_RUN_COLUMNS = 'id, repo_id, name, prompt, isolated, base_ref, created_at'

const MULTI_RUN_ENTRY_COLUMNS = 'id, multi_run_id, model, status, session_id, directory, error, created_at, updated_at'

const MULTI_RUN_FUSION_COLUMNS =
  'id, multi_run_id, request_id, model, instructions, isolated, base_ref, sources, status, session_id, directory, error, created_at, updated_at'

export function ensureMultiRunTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS multi_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      isolated INTEGER NOT NULL,
      base_ref TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS multi_run_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      multi_run_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('starting','started','failed','discarded')),
      session_id TEXT,
      directory TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_multi_run_entries_group
    ON multi_run_entries(multi_run_id)
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_multi_runs_repo
    ON multi_runs(repo_id, created_at DESC)
  `)
}

export function ensureMultiRunFusionTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS multi_run_fusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      multi_run_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      model TEXT NOT NULL,
      instructions TEXT,
      isolated INTEGER NOT NULL,
      base_ref TEXT,
      sources TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('starting','started','failed')),
      session_id TEXT,
      directory TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(multi_run_id, request_id)
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_multi_run_fusions_group
    ON multi_run_fusions(multi_run_id)
  `)
}

export function createMultiRunWithEntries(
  db: Database,
  group: CreateMultiRunGroup,
  models: string[],
): MultiRunRecord {
  const now = Date.now()
  const create = db.transaction(() => {
    const result = db
      .prepare(`INSERT INTO multi_runs(repo_id, name, prompt, isolated, base_ref, created_at) VALUES(?,?,?,?,?,?)`)
      .run(group.repoId, group.name, group.prompt, group.isolated ? 1 : 0, group.baseRef, now)
    const multiRunId = Number(result.lastInsertRowid)

    const insertEntry = db.prepare(`
      INSERT INTO multi_run_entries(multi_run_id, model, status, session_id, directory, error, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?)
    `)
    for (const model of models) {
      insertEntry.run(multiRunId, model, 'starting', null, null, null, now, now)
    }

    return multiRunId
  })

  const record = getMultiRun(db, create())
  if (!record) {
    throw new Error('Failed to create multi-run')
  }
  return record
}

export function getMultiRun(db: Database, id: number): MultiRunRecord | null {
  const row = db
    .prepare(`SELECT ${MULTI_RUN_COLUMNS} FROM multi_runs WHERE id = ?`)
    .get(id) as MultiRunRow | undefined
  if (!row) {
    return null
  }
  return toMultiRunRecord(row, loadEntries(db, row.id), loadFusions(db, row.id))
}

export function listMultiRuns(db: Database, repoId: number, limit: number): MultiRunRecord[] {
  const rows = db
    .prepare(`
      SELECT ${MULTI_RUN_COLUMNS} FROM multi_runs
      WHERE repo_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .all(repoId, limit) as MultiRunRow[]
  if (rows.length === 0) {
    return []
  }

  const placeholders = rows.map(() => '?').join(', ')
  const entryRows = db
    .prepare(`
      SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries
      WHERE multi_run_id IN (${placeholders})
      ORDER BY multi_run_id ASC, id ASC
    `)
    .all(...rows.map((row) => row.id)) as MultiRunEntryRow[]

  const entriesByRun = new Map<number, MultiRunEntryRow[]>()
  for (const row of rows) {
    entriesByRun.set(row.id, [])
  }
  for (const entryRow of entryRows) {
    entriesByRun.get(entryRow.multi_run_id)?.push(entryRow)
  }

  const fusionRows = db
    .prepare(`
      SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions
      WHERE multi_run_id IN (${placeholders})
      ORDER BY multi_run_id ASC, id ASC
    `)
    .all(...rows.map((row) => row.id)) as MultiRunFusionRow[]

  const fusionsByRun = new Map<number, MultiRunFusionRow[]>()
  for (const row of rows) {
    fusionsByRun.set(row.id, [])
  }
  for (const fusionRow of fusionRows) {
    fusionsByRun.get(fusionRow.multi_run_id)?.push(fusionRow)
  }

  return rows.map((row) =>
    toMultiRunRecord(row, entriesByRun.get(row.id) ?? [], fusionsByRun.get(row.id) ?? []),
  )
}

export function getMultiRunEntry(db: Database, multiRunId: number, entryId: number): MultiRunEntryRecord | null {
  const row = db
    .prepare(`SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries WHERE id = ? AND multi_run_id = ?`)
    .get(entryId, multiRunId) as MultiRunEntryRow | undefined
  if (!row) {
    return null
  }

  const group = db.prepare('SELECT isolated FROM multi_runs WHERE id = ?').get(multiRunId) as
    | { isolated: number }
    | undefined
  return mapEntryRow(row, group?.isolated === 1)
}

export function updateMultiRunEntry(
  db: Database,
  entryId: number,
  fromStatuses: MultiRunEntryStatus[],
  patch: MultiRunEntryPatch,
): MultiRunEntryRecord | null {
  if (!runGuardedStatusUpdate(db, 'multi_run_entries', entryId, fromStatuses, patch)) {
    return null
  }

  const row = db.prepare('SELECT multi_run_id FROM multi_run_entries WHERE id = ?').get(entryId) as
    | { multi_run_id: number }
    | undefined
  if (!row) {
    return null
  }
  return getMultiRunEntry(db, row.multi_run_id, entryId)
}

export function getMultiRunFusionByRequest(
  db: Database,
  multiRunId: number,
  requestId: string,
): MultiRunFusionRecord | null {
  const row = db
    .prepare(`SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions WHERE multi_run_id = ? AND request_id = ?`)
    .get(multiRunId, requestId) as MultiRunFusionRow | undefined
  if (!row) {
    return null
  }
  return mapFusionRow(row)
}

export function insertMultiRunFusion(
  db: Database,
  input: CreateMultiRunFusionInput,
): { fusion: MultiRunFusionRecord; created: boolean } {
  const now = Date.now()
  return db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO multi_run_fusions(
          multi_run_id, request_id, model, instructions, isolated, base_ref, sources,
          status, session_id, directory, error, created_at, updated_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(multi_run_id, request_id) DO NOTHING
      `)
      .run(
        input.multiRunId,
        input.requestId,
        input.model,
        input.instructions,
        input.isolated ? 1 : 0,
        input.baseRef,
        JSON.stringify(input.sources),
        'starting',
        null,
        null,
        null,
        now,
        now,
      )
    const fusion = getMultiRunFusionByRequest(db, input.multiRunId, input.requestId)
    if (!fusion) {
      throw new Error('Failed to create multi-run fusion')
    }
    return { fusion, created: result.changes > 0 }
  })()
}

export function updateMultiRunFusion(
  db: Database,
  fusionId: number,
  fromStatuses: MultiRunFusionStatus[],
  patch: MultiRunFusionPatch,
): MultiRunFusionRecord | null {
  if (!runGuardedStatusUpdate(db, 'multi_run_fusions', fusionId, fromStatuses, patch)) {
    return null
  }

  const row = db.prepare('SELECT multi_run_id, request_id FROM multi_run_fusions WHERE id = ?').get(fusionId) as
    | { multi_run_id: number; request_id: string }
    | undefined
  if (!row) {
    return null
  }
  return getMultiRunFusionByRequest(db, row.multi_run_id, row.request_id)
}

type GuardedUpdateTable = 'multi_run_entries' | 'multi_run_fusions'

interface GuardedUpdatePatch {
  status?: string
  sessionId?: string | null
  directory?: string | null
  error?: string | null
}

function runGuardedStatusUpdate(
  db: Database,
  table: GuardedUpdateTable,
  id: number,
  fromStatuses: readonly string[],
  patch: GuardedUpdatePatch,
): boolean {
  const assignments: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [Date.now()]

  if (patch.status !== undefined) {
    assignments.push('status = ?')
    values.push(patch.status)
  }
  if (patch.sessionId !== undefined) {
    assignments.push('session_id = ?')
    values.push(patch.sessionId)
  }
  if (patch.directory !== undefined) {
    assignments.push('directory = ?')
    values.push(patch.directory)
  }
  if (patch.error !== undefined) {
    assignments.push('error = ?')
    values.push(patch.error)
  }

  const placeholders = fromStatuses.map(() => '?').join(', ')
  const result = db
    .prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ? AND status IN (${placeholders})`)
    .run(...values, id, ...fromStatuses)

  return result.changes > 0
}

function loadEntries(db: Database, multiRunId: number): MultiRunEntryRow[] {
  return db
    .prepare(`SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries WHERE multi_run_id = ? ORDER BY id ASC`)
    .all(multiRunId) as MultiRunEntryRow[]
}

function loadFusions(db: Database, multiRunId: number): MultiRunFusionRow[] {
  return db
    .prepare(`SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions WHERE multi_run_id = ? ORDER BY id ASC`)
    .all(multiRunId) as MultiRunFusionRow[]
}

function toMultiRunRecord(
  row: MultiRunRow,
  entries: MultiRunEntryRow[],
  fusions: MultiRunFusionRow[],
): MultiRunRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    prompt: row.prompt,
    isolated: row.isolated === 1,
    baseRef: row.base_ref,
    createdAt: row.created_at,
    entries: entries.map((entry) => mapEntryRow(entry, row.isolated === 1)),
    fusions: fusions.map(mapFusionRow),
  }
}

function mapFusionRow(row: MultiRunFusionRow): MultiRunFusionRecord {
  return {
    id: row.id,
    multiRunId: row.multi_run_id,
    requestId: row.request_id,
    model: row.model,
    instructions: row.instructions,
    isolated: row.isolated === 1,
    baseRef: row.base_ref,
    sources: MultiRunFusionSourceSchema.array().parse(JSON.parse(row.sources)),
    status: row.status,
    sessionId: row.session_id,
    directory: row.directory,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEntryRow(row: MultiRunEntryRow, isolated: boolean): MultiRunEntryRecord {
  return {
    id: row.id,
    model: row.model,
    status: row.status,
    sessionId: row.session_id,
    directory: row.directory,
    isolated,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
