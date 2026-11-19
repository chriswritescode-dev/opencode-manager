import type { Database } from 'bun:sqlite'
import {
  MultiRunEntryStatusSchema,
  MultiRunFusionSourceSchema,
  MultiRunFusionStatusSchema,
  type MultiRunEntryStatus,
  type MultiRunFusionSource,
  type MultiRunFusionStatus,
  type MultiRunTarget,
} from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { selectRow, selectRows } from './rows'

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
  repoId: number | null
  serverId: string
  directory: string | null
  name: string
  prompt: string
  isolated: boolean
  baseRef: string | null
  createdAt: number
  entries: MultiRunEntryRecord[]
  fusions: MultiRunFusionRecord[]
}

export interface CreateMultiRunGroup {
  repoId: number | null
  serverId: string
  directory: string | null
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

const MultiRunRowSchema = z.object({
  id: z.number(),
  repo_id: z.number().nullable(),
  server_id: z.string(),
  directory: z.string().nullable(),
  name: z.string(),
  prompt: z.string(),
  isolated: z.number(),
  base_ref: z.string().nullable(),
  created_at: z.number(),
})

type MultiRunRow = z.infer<typeof MultiRunRowSchema>

const MultiRunEntryRowSchema = z.object({
  id: z.number(),
  multi_run_id: z.number(),
  model: z.string(),
  status: MultiRunEntryStatusSchema,
  session_id: z.string().nullable(),
  directory: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
})

type MultiRunEntryRow = z.infer<typeof MultiRunEntryRowSchema>

const MultiRunFusionRowSchema = z.object({
  id: z.number(),
  multi_run_id: z.number(),
  request_id: z.string(),
  model: z.string(),
  instructions: z.string().nullable(),
  isolated: z.number(),
  base_ref: z.string().nullable(),
  sources: z.string(),
  status: MultiRunFusionStatusSchema,
  session_id: z.string().nullable(),
  directory: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
})

type MultiRunFusionRow = z.infer<typeof MultiRunFusionRowSchema>

const MultiRunIdRowSchema = z.object({ multi_run_id: z.number() })

const MultiRunFusionRefRowSchema = z.object({
  multi_run_id: z.number(),
  request_id: z.string(),
})

const MultiRunIsolatedRowSchema = z.object({ isolated: z.number() })

const MULTI_RUN_COLUMNS = 'id, repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at'

const MULTI_RUN_ENTRY_COLUMNS = 'id, multi_run_id, model, status, session_id, directory, error, created_at, updated_at'

const MULTI_RUN_FUSION_COLUMNS =
  'id, multi_run_id, request_id, model, instructions, isolated, base_ref, sources, status, session_id, directory, error, created_at, updated_at'

export function ensureMultiRunTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS multi_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER,
      server_id TEXT NOT NULL DEFAULT 'local',
      directory TEXT,
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
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_multi_runs_server
    ON multi_runs(server_id, directory, created_at DESC)
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
      .prepare(
        `INSERT INTO multi_runs(repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        group.repoId,
        group.serverId,
        group.directory,
        group.name,
        group.prompt,
        group.isolated ? 1 : 0,
        group.baseRef,
        now,
      )
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
  const row = selectRow(db, MultiRunRowSchema, `SELECT ${MULTI_RUN_COLUMNS} FROM multi_runs WHERE id = ?`, id)
  if (!row) {
    return null
  }
  return toMultiRunRecord(row, loadEntries(db, row.id), loadFusions(db, row.id))
}

export function listMultiRuns(db: Database, target: MultiRunTarget, limit: number): MultiRunRecord[] {
  const [where, params] =
    target.kind === 'repo'
      ? ['repo_id = ?', [target.repoId] as const]
      : ['server_id = ? AND directory = ?', [target.serverId, target.directory] as const]

  const rows = selectRows(
    db,
    MultiRunRowSchema,
    `
      SELECT ${MULTI_RUN_COLUMNS} FROM multi_runs
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    ...params,
    limit,
  )
  if (rows.length === 0) {
    return []
  }

  const placeholders = rows.map(() => '?').join(', ')
  const entryRows = selectRows(
    db,
    MultiRunEntryRowSchema,
    `
      SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries
      WHERE multi_run_id IN (${placeholders})
      ORDER BY multi_run_id ASC, id ASC
    `,
    ...rows.map((row) => row.id),
  )

  const entriesByRun = new Map<number, MultiRunEntryRow[]>()
  for (const row of rows) {
    entriesByRun.set(row.id, [])
  }
  for (const entryRow of entryRows) {
    entriesByRun.get(entryRow.multi_run_id)?.push(entryRow)
  }

  const fusionRows = selectRows(
    db,
    MultiRunFusionRowSchema,
    `
      SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions
      WHERE multi_run_id IN (${placeholders})
      ORDER BY multi_run_id ASC, id ASC
    `,
    ...rows.map((row) => row.id),
  )

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
  const row = selectRow(
    db,
    MultiRunEntryRowSchema,
    `SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries WHERE id = ? AND multi_run_id = ?`,
    entryId,
    multiRunId,
  )
  if (!row) {
    return null
  }

  const group = selectRow(db, MultiRunIsolatedRowSchema, 'SELECT isolated FROM multi_runs WHERE id = ?', multiRunId)
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

  const row = selectRow(db, MultiRunIdRowSchema, 'SELECT multi_run_id FROM multi_run_entries WHERE id = ?', entryId)
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
  const row = selectRow(
    db,
    MultiRunFusionRowSchema,
    `SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions WHERE multi_run_id = ? AND request_id = ?`,
    multiRunId,
    requestId,
  )
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

  const row = selectRow(
    db,
    MultiRunFusionRefRowSchema,
    'SELECT multi_run_id, request_id FROM multi_run_fusions WHERE id = ?',
    fusionId,
  )
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
  return selectRows(
    db,
    MultiRunEntryRowSchema,
    `SELECT ${MULTI_RUN_ENTRY_COLUMNS} FROM multi_run_entries WHERE multi_run_id = ? ORDER BY id ASC`,
    multiRunId,
  )
}

function loadFusions(db: Database, multiRunId: number): MultiRunFusionRow[] {
  return selectRows(
    db,
    MultiRunFusionRowSchema,
    `SELECT ${MULTI_RUN_FUSION_COLUMNS} FROM multi_run_fusions WHERE multi_run_id = ? ORDER BY id ASC`,
    multiRunId,
  )
}

function toMultiRunRecord(
  row: MultiRunRow,
  entries: MultiRunEntryRow[],
  fusions: MultiRunFusionRow[],
): MultiRunRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    serverId: row.server_id,
    directory: row.directory,
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
