import type { Database } from 'bun:sqlite'
import {
  ScheduleJobSchema,
  ScheduleMcpServersSchema,
  SchedulePermissionConfigSchema,
  ScheduleRunSchema,
  ScheduleSkillMetadataSchema,
  type ScheduleJob,
  type ScheduleMcpServer,
  type ScheduleMode,
  type SchedulePermissionConfig,
  type ScheduleRun,
  type ScheduleRunStatus,
  type ScheduleRunTriggerSource,
} from '@opencode-manager/shared/schemas'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME, ASSISTANT_REPO_PATH, getRepoDisplayName } from '@opencode-manager/shared/utils'
import type { ScheduleJobPersistenceInput } from '../services/schedule-config'

interface ScheduleJobRow {
  id: number
  repo_id: number
  name: string
  description: string | null
  enabled: number
  schedule_mode: ScheduleMode | null
  interval_minutes: number | null
  cron_expression: string | null
  timezone: string | null
  agent_slug: string | null
  prompt: string
  model: string | null
  skill_metadata: string | null
  permission_config: string | null
  mcp_servers: string | null
  branch: string | null
  created_at: number
  updated_at: number
  last_run_at: number | null
  next_run_at: number | null
}

interface ScheduleRunRow {
  id: number
  job_id: number
  repo_id: number
  trigger_source: string
  status: string
  started_at: number
  finished_at: number | null
  viewed_at: number | null
  created_at: number
  session_id: string | null
  session_title: string | null
  log_text: string | null
  response_text: string | null
  error_text: string | null
  run_branch: string | null
  commit_hash: string | null
  worktree_path: string | null
}

function parseSkillMetadata(raw: string | null) {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const result = ScheduleSkillMetadataSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function parsePermissionConfig(raw: string | null): SchedulePermissionConfig | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const result = SchedulePermissionConfigSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function parseMcpServers(raw: string | null): ScheduleMcpServer[] {
  if (!raw) {
    return []
  }

  try {
    const result = ScheduleMcpServersSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : []
  } catch {
    return []
  }
}

function rowToScheduleJob(row: ScheduleJobRow): ScheduleJob {
  return ScheduleJobSchema.parse({
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    scheduleMode: row.schedule_mode ?? 'interval',
    intervalMinutes: row.interval_minutes,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    agentSlug: row.agent_slug,
    prompt: row.prompt,
    model: row.model,
    skillMetadata: parseSkillMetadata(row.skill_metadata),
    permissionConfig: parsePermissionConfig(row.permission_config),
    mcpServers: parseMcpServers(row.mcp_servers),
    branch: row.branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  })
}

function rowToScheduleRun(row: ScheduleRunRow): ScheduleRun {
  return ScheduleRunSchema.parse({
    id: row.id,
    jobId: row.job_id,
    repoId: row.repo_id,
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    viewedAt: row.viewed_at,
    createdAt: row.created_at,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    logText: row.log_text,
    responseText: row.response_text,
    errorText: row.error_text,
    runBranch: row.run_branch,
    commitHash: row.commit_hash,
    worktreePath: row.worktree_path,
  })
}

function serializeSkillMetadata(skillMetadata: ScheduleJobPersistenceInput['skillMetadata']): string | null {
  if (!skillMetadata) {
    return null
  }

  return JSON.stringify(skillMetadata)
}

function serializePermissionConfig(permissionConfig: ScheduleJobPersistenceInput['permissionConfig']): string | null {
  if (!permissionConfig) {
    return null
  }

  return JSON.stringify(permissionConfig)
}

function serializeMcpServers(mcpServers: ScheduleJobPersistenceInput['mcpServers']): string | null {
  return mcpServers.length > 0 ? JSON.stringify(mcpServers) : null
}

export function listScheduleJobsByRepo(db: Database, repoId: number): ScheduleJob[] {
  const stmt = db.prepare('SELECT * FROM schedule_jobs WHERE repo_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(repoId) as ScheduleJobRow[]
  return rows.map(rowToScheduleJob)
}

export function listScheduleJobIdsByRepo(db: Database, repoId: number): number[] {
  const stmt = db.prepare('SELECT id FROM schedule_jobs WHERE repo_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(repoId) as Array<{ id: number }>
  return rows.map((row) => row.id)
}

export function listEnabledScheduleJobs(db: Database): ScheduleJob[] {
  const stmt = db.prepare('SELECT * FROM schedule_jobs WHERE enabled = 1 ORDER BY id ASC')
  const rows = stmt.all() as ScheduleJobRow[]
  return rows.map(rowToScheduleJob)
}

export function getScheduleJobById(db: Database, repoId: number, jobId: number): ScheduleJob | null {
  const stmt = db.prepare('SELECT * FROM schedule_jobs WHERE repo_id = ? AND id = ?')
  const row = stmt.get(repoId, jobId) as ScheduleJobRow | undefined
  return row ? rowToScheduleJob(row) : null
}

export function createScheduleJob(db: Database, repoId: number, input: ScheduleJobPersistenceInput): ScheduleJob {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO schedule_jobs (
      repo_id, name, description, enabled, schedule_mode, interval_minutes, cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
      permission_config,
      mcp_servers,
      branch,
      created_at, updated_at, last_run_at, next_run_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    repoId,
    input.name,
    input.description ?? null,
    input.enabled ? 1 : 0,
    input.scheduleMode,
    input.intervalMinutes,
    input.cronExpression,
    input.timezone,
    input.agentSlug ?? null,
    input.prompt,
    input.model ?? null,
    serializeSkillMetadata(input.skillMetadata),
    serializePermissionConfig(input.permissionConfig),
    serializeMcpServers(input.mcpServers),
    input.branch,
    now,
    now,
    null,
    input.nextRunAt,
  )

  const job = getScheduleJobById(db, repoId, Number(result.lastInsertRowid))
  if (!job) {
    throw new Error('Failed to load created schedule job')
  }
  return job
}

export function updateScheduleJob(db: Database, repoId: number, jobId: number, input: ScheduleJobPersistenceInput): ScheduleJob | null {
  const existing = getScheduleJobById(db, repoId, jobId)
  if (!existing) {
    return null
  }

  const now = Date.now()

  const stmt = db.prepare(`
    UPDATE schedule_jobs
    SET name = ?, description = ?, enabled = ?, schedule_mode = ?, interval_minutes = ?, cron_expression = ?, timezone = ?,
        agent_slug = ?, prompt = ?, model = ?, skill_metadata = ?, permission_config = ?, mcp_servers = ?, branch = ?, updated_at = ?, next_run_at = ?
    WHERE repo_id = ? AND id = ?
  `)

  stmt.run(
    input.name,
    input.description,
    input.enabled ? 1 : 0,
    input.scheduleMode,
    input.intervalMinutes,
    input.cronExpression,
    input.timezone,
    input.agentSlug,
    input.prompt,
    input.model,
    serializeSkillMetadata(input.skillMetadata),
    serializePermissionConfig(input.permissionConfig),
    serializeMcpServers(input.mcpServers),
    input.branch,
    now,
    input.nextRunAt,
    repoId,
    jobId,
  )

  return getScheduleJobById(db, repoId, jobId)
}

export function deleteScheduleJob(db: Database, repoId: number, jobId: number): boolean {
  db.prepare('DELETE FROM schedule_runs WHERE repo_id = ? AND job_id = ?').run(repoId, jobId)
  const stmt = db.prepare('DELETE FROM schedule_jobs WHERE repo_id = ? AND id = ?')
  const result = stmt.run(repoId, jobId)
  return result.changes > 0
}

export interface ScheduleRunArtifact {
  id: number
  status: ScheduleRunStatus
  runBranch: string | null
  worktreePath: string | null
}

export function listScheduleRunArtifactsByJob(db: Database, repoId: number, jobId: number): ScheduleRunArtifact[] {
  const rows = db
    .prepare('SELECT id, status, run_branch, worktree_path FROM schedule_runs WHERE repo_id = ? AND job_id = ? ORDER BY id DESC')
    .all(repoId, jobId) as { id: number; status: string; run_branch: string | null; worktree_path: string | null }[]
  return rows.map((row) => ({
    id: row.id,
    status: row.status as ScheduleRunStatus,
    runBranch: row.run_branch,
    worktreePath: row.worktree_path,
  }))
}

export function listActiveScheduleRunWorktreePaths(db: Database): string[] {
  const rows = db
    .prepare('SELECT worktree_path FROM schedule_runs WHERE worktree_path IS NOT NULL')
    .all() as { worktree_path: string }[]
  return rows.map((row) => row.worktree_path)
}

export function deleteScheduleRunById(db: Database, repoId: number, jobId: number, runId: number): boolean {
  const result = db
    .prepare('DELETE FROM schedule_runs WHERE repo_id = ? AND job_id = ? AND id = ?')
    .run(repoId, jobId, runId)
  return result.changes > 0
}

export function deleteScheduleRunsByIds(db: Database, repoId: number, jobId: number, runIds: number[]): number {
  if (runIds.length === 0) return 0
  const placeholders = runIds.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM schedule_runs WHERE repo_id = ? AND job_id = ? AND id IN (${placeholders})`)
    .run(repoId, jobId, ...runIds)
  return result.changes
}

export function cleanupOrphanedSchedules(db: Database): { orphanedJobs: number; orphanedRuns: number } {
  const runStmt = db.prepare(`
    DELETE FROM schedule_runs
    WHERE (repo_id != ? AND repo_id NOT IN (SELECT id FROM repos))
       OR job_id NOT IN (SELECT id FROM schedule_jobs)
  `)
  const orphanedRuns = runStmt.run(ASSISTANT_REPO_ID).changes

  const jobStmt = db.prepare(`
    DELETE FROM schedule_jobs
    WHERE repo_id != ? AND repo_id NOT IN (SELECT id FROM repos)
  `)
  const orphanedJobs = jobStmt.run(ASSISTANT_REPO_ID).changes

  return { orphanedJobs, orphanedRuns }
}

export function updateScheduleJobRunState(db: Database, repoId: number, jobId: number, values: { lastRunAt: number; nextRunAt?: number | null }): void {
  const stmt = db.prepare('UPDATE schedule_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE repo_id = ? AND id = ?')
  stmt.run(values.lastRunAt, values.nextRunAt ?? null, Date.now(), repoId, jobId)
}

export function updateScheduleJobsBranch(db: Database, repoId: number, from: string, to: string): number {
  const stmt = db.prepare('UPDATE schedule_jobs SET branch = ?, updated_at = ? WHERE repo_id = ? AND branch = ?')
  return stmt.run(to, Date.now(), repoId, from).changes
}

export function createScheduleRun(
  db: Database,
  input: {
    jobId: number
    repoId: number
    triggerSource: ScheduleRunTriggerSource
    status: ScheduleRunStatus
    startedAt: number
    createdAt: number
  },
): ScheduleRun {
  const stmt = db.prepare(`
    INSERT INTO schedule_runs (job_id, repo_id, trigger_source, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    input.jobId,
    input.repoId,
    input.triggerSource,
    input.status,
    input.startedAt,
    input.createdAt,
  )

  const run = getScheduleRunById(db, input.repoId, input.jobId, Number(result.lastInsertRowid))
  if (!run) {
    throw new Error('Failed to load created schedule run')
  }
  return run
}

export function updateScheduleRun(
  db: Database,
  repoId: number,
  jobId: number,
  runId: number,
  input: {
    status: ScheduleRunStatus
    finishedAt: number
    sessionId?: string | null
    sessionTitle?: string | null
    logText?: string | null
    responseText?: string | null
    errorText?: string | null
  },
): ScheduleRun | null {
  const stmt = db.prepare(`
    UPDATE schedule_runs
    SET status = ?, finished_at = ?, session_id = ?, session_title = ?, log_text = ?, response_text = ?, error_text = ?
    WHERE repo_id = ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.status,
    input.finishedAt,
    input.sessionId ?? null,
    input.sessionTitle ?? null,
    input.logText ?? null,
    input.responseText ?? null,
    input.errorText ?? null,
    repoId,
    jobId,
    runId,
  )

  return getScheduleRunById(db, repoId, jobId, runId)
}

export function updateScheduleRunMetadata(
  db: Database,
  repoId: number,
  jobId: number,
  runId: number,
  input: {
    sessionId?: string | null
    sessionTitle?: string | null
    logText?: string | null
    responseText?: string | null
    errorText?: string | null
  },
): ScheduleRun | null {
  const existing = getScheduleRunById(db, repoId, jobId, runId)
  if (!existing) {
    return null
  }

  const stmt = db.prepare(`
    UPDATE schedule_runs
    SET session_id = ?, session_title = ?, log_text = ?, response_text = ?, error_text = ?
    WHERE repo_id = ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.sessionId === undefined ? existing.sessionId : input.sessionId,
    input.sessionTitle === undefined ? existing.sessionTitle : input.sessionTitle,
    input.logText === undefined ? existing.logText : input.logText,
    input.responseText === undefined ? existing.responseText : input.responseText,
    input.errorText === undefined ? existing.errorText : input.errorText,
    repoId,
    jobId,
    runId,
  )

  return getScheduleRunById(db, repoId, jobId, runId)
}

export function updateScheduleRunWorktree(
  db: Database,
  repoId: number,
  jobId: number,
  runId: number,
  input: { worktreePath?: string | null; runBranch?: string | null; commitHash?: string | null },
): ScheduleRun | null {
  const existing = getScheduleRunById(db, repoId, jobId, runId)
  if (!existing) {
    return null
  }

  const stmt = db.prepare(`
    UPDATE schedule_runs
    SET worktree_path = ?, run_branch = ?, commit_hash = ?
    WHERE repo_id = ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.worktreePath === undefined ? existing.worktreePath : input.worktreePath,
    input.runBranch === undefined ? existing.runBranch : input.runBranch,
    input.commitHash === undefined ? existing.commitHash : input.commitHash,
    repoId,
    jobId,
    runId,
  )

  return getScheduleRunById(db, repoId, jobId, runId)
}

export function getScheduleRunById(db: Database, repoId: number, jobId: number, runId: number): ScheduleRun | null {
  const stmt = db.prepare('SELECT * FROM schedule_runs WHERE repo_id = ? AND job_id = ? AND id = ?')
  const row = stmt.get(repoId, jobId, runId) as ScheduleRunRow | undefined
  return row ? rowToScheduleRun(row) : null
}

export function getScheduleRunBySessionId(db: Database, sessionId: string): ScheduleRun | null {
  const stmt = db.prepare('SELECT * FROM schedule_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1')
  const row = stmt.get(sessionId) as ScheduleRunRow | undefined
  return row ? rowToScheduleRun(row) : null
}

export function getRunningScheduleRunByJob(db: Database, repoId: number, jobId: number): ScheduleRun | null {
  const stmt = db.prepare(`
    SELECT * FROM schedule_runs
    WHERE repo_id = ? AND job_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `)
  const row = stmt.get(repoId, jobId) as ScheduleRunRow | undefined
  return row ? rowToScheduleRun(row) : null
}

export function listRunningScheduleRuns(db: Database, limit: number = 100): ScheduleRun[] {
  const stmt = db.prepare(`
    SELECT * FROM schedule_runs
    WHERE status = 'running'
    ORDER BY started_at ASC
    LIMIT ?
  `)
  const rows = stmt.all(limit) as ScheduleRunRow[]
  return rows.map(rowToScheduleRun)
}

export function listScheduleRunsByJob(db: Database, repoId: number, jobId: number, limit: number = 20): ScheduleRun[] {
  const stmt = db.prepare(`
    SELECT
      id,
      job_id,
      repo_id,
      trigger_source,
      status,
      started_at,
      finished_at,
      viewed_at,
      created_at,
      session_id,
      session_title,
      NULL AS log_text,
      NULL AS response_text,
      error_text,
      run_branch,
      commit_hash,
      worktree_path
    FROM schedule_runs
    WHERE repo_id = ? AND job_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(repoId, jobId, limit) as ScheduleRunRow[]
  return rows.map(rowToScheduleRun)
}

export interface ScheduleRunSummary {
  id: number
  status: ScheduleRunStatus
  startedAt: number
  finishedAt: number | null
  viewedAt: number | null
  preview: string | null
}

export interface ScheduleJobWithRepo extends ScheduleJob {
  repoName: string
  repoPath: string
  repoUrl: string
  lastRun: ScheduleRunSummary | null
}

interface ScheduleJobWithRepoRow extends ScheduleJobRow {
  repo_url: string | null
  repo_path: string | null
  repo_name: string | null
  repo_source_path: string | null
  last_run_id: number | null
  last_run_status: string | null
  last_run_started_at: number | null
  last_run_finished_at: number | null
  last_run_viewed_at: number | null
  last_run_error_text: string | null
  last_run_response_head: string | null
}

interface RepoDisplayRow {
  repo_id: number
  repo_path: string | null
  repo_name: string | null
  repo_url?: string | null
  repo_source_path?: string | null
}

function resolveRepoDisplay(row: RepoDisplayRow): { repoName: string; repoPath: string } {
  if (row.repo_id === ASSISTANT_REPO_ID) {
    return { repoName: ASSISTANT_REPO_NAME, repoPath: ASSISTANT_REPO_PATH }
  }
  const displayName = getRepoDisplayName({
    name: row.repo_name,
    repoUrl: row.repo_url,
    sourcePath: row.repo_source_path,
    localPath: row.repo_path,
  })
  return { repoName: displayName, repoPath: row.repo_path ?? '' }
}

function buildLastRunSummary(row: ScheduleJobWithRepoRow): ScheduleRunSummary | null {
  if (row.last_run_id === null || row.last_run_id === undefined) {
    return null
  }

  return {
    id: row.last_run_id,
    status: row.last_run_status as ScheduleRunStatus,
    startedAt: row.last_run_started_at ?? 0,
    finishedAt: row.last_run_finished_at,
    viewedAt: row.last_run_viewed_at,
    preview: extractReportPreview(row.last_run_status === 'failed' ? row.last_run_error_text : row.last_run_response_head),
  }
}

function rowToScheduleJobWithRepo(row: ScheduleJobWithRepoRow): ScheduleJobWithRepo {
  return {
    ...rowToScheduleJob(row),
    ...resolveRepoDisplay(row),
    repoUrl: row.repo_url ?? '',
    lastRun: buildLastRunSummary(row),
  }
}

export function listAllScheduleJobsWithRepos(db: Database): ScheduleJobWithRepo[] {
  const stmt = db.prepare(`
    SELECT
      sj.*, r.repo_url, r.local_path as repo_path, r.name as repo_name, r.source_path as repo_source_path,
      sr.id AS last_run_id,
      sr.status AS last_run_status,
      sr.started_at AS last_run_started_at,
      sr.finished_at AS last_run_finished_at,
      sr.viewed_at AS last_run_viewed_at,
      substr(sr.error_text, 1, 600) AS last_run_error_text,
      substr(sr.response_text, 1, 600) AS last_run_response_head
    FROM schedule_jobs sj
    LEFT JOIN repos r ON sj.repo_id = r.id
    LEFT JOIN schedule_runs sr ON sr.id = (
      SELECT id FROM schedule_runs WHERE job_id = sj.id ORDER BY started_at DESC LIMIT 1
    )
    ORDER BY COALESCE(r.local_path, ''), sj.name
  `)
  const rows = stmt.all() as ScheduleJobWithRepoRow[]
  return rows.map(rowToScheduleJobWithRepo)
}

export interface ScheduleRunWithContext extends ScheduleRun {
  jobName: string
  repoName: string
  repoPath: string
}

interface ScheduleRunWithContextRow extends ScheduleRunRow {
  job_name: string
  repo_path: string | null
  repo_name: string | null
  repo_url: string | null
  repo_source_path: string | null
}

function rowToScheduleRunWithContext(row: ScheduleRunWithContextRow): ScheduleRunWithContext {
  return {
    ...rowToScheduleRun(row),
    jobName: row.job_name,
    ...resolveRepoDisplay(row),
  }
}

export interface ListAllRunsOptions {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
  runId?: number
  search?: string
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export function listAllScheduleRuns(db: Database, options: ListAllRunsOptions = {}): ScheduleRunWithContext[] {
  const { limit = 50, offset = 0, status, repoId, jobId, triggerSource, runId, search } = options
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (status) {
    conditions.push('sr.status = ?')
    params.push(status)
  }
  if (repoId !== undefined) {
    conditions.push('sr.repo_id = ?')
    params.push(repoId)
  }
  if (jobId !== undefined) {
    conditions.push('sr.job_id = ?')
    params.push(jobId)
  }
  if (triggerSource) {
    conditions.push('sr.trigger_source = ?')
    params.push(triggerSource)
  }
  if (runId !== undefined) {
    conditions.push('sr.id = ?')
    params.push(runId)
  }
  const searchTerm = search?.trim()
  if (searchTerm) {
    const pattern = `%${escapeLikePattern(searchTerm)}%`
    const searchColumns = ['sj.name', 'sr.session_title', 'sr.error_text', 'sr.run_branch', 'r.name', 'r.local_path']
    conditions.push(`(${searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    params.push(...searchColumns.map(() => pattern))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const stmt = db.prepare(`
    SELECT
      sr.id, sr.job_id, sr.repo_id, sr.trigger_source, sr.status,
      sr.started_at, sr.finished_at, sr.created_at,
      sr.session_id, sr.session_title,
      NULL AS log_text, NULL AS response_text, sr.error_text,
      sr.viewed_at,
      sr.run_branch, sr.commit_hash, sr.worktree_path,
      sj.name AS job_name, r.local_path AS repo_path, r.name AS repo_name,
      r.repo_url AS repo_url, r.source_path AS repo_source_path
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sr.job_id = sj.id
    LEFT JOIN repos r ON sr.repo_id = r.id
    ${whereClause}
    ORDER BY sr.started_at DESC
    LIMIT ? OFFSET ?
  `)

  params.push(limit, offset)
  const rows = stmt.all(...params) as ScheduleRunWithContextRow[]
  return rows.map(rowToScheduleRunWithContext)
}

const REPORT_PREVIEW_MAX_LENGTH = 160

function normalizeReportLine(rawLine: string): string {
  return rawLine
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reduces a finished run's markdown report to a single short, plain-text line
 * suitable for a notification or list preview, preferring the first heading
 * over any conversational preamble.
 */
export function extractReportPreview(text: string | null): string | null {
  if (!text) {
    return null
  }

  const rawLines = text.split('\n')
  const headingLine = rawLines.find((rawLine) => /^\s*#{1,6}\s+\S/.test(rawLine))
  const line = headingLine
    ? normalizeReportLine(headingLine)
    : rawLines.map(normalizeReportLine).find((candidate) => candidate.length > 0)

  if (!line) {
    return null
  }

  return line.length > REPORT_PREVIEW_MAX_LENGTH
    ? `${line.slice(0, REPORT_PREVIEW_MAX_LENGTH).trimEnd()}…`
    : line
}

export interface ScheduleRunWithUnreadPreview extends ScheduleRunWithContext {
  preview: string | null
}

interface UnreadScheduleRunRow extends ScheduleRunWithContextRow {
  response_head: string | null
}

export function listUnreadScheduleRuns(db: Database, limit: number = 20): ScheduleRunWithUnreadPreview[] {
  const stmt = db.prepare(`
    SELECT
      sr.id, sr.job_id, sr.repo_id, sr.trigger_source, sr.status,
      sr.started_at, sr.finished_at, sr.created_at,
      sr.session_id, sr.session_title, sr.viewed_at,
      NULL AS log_text, NULL AS response_text, sr.error_text,
      sr.run_branch, sr.commit_hash, sr.worktree_path,
      sj.name AS job_name, r.local_path AS repo_path, r.name AS repo_name,
      r.repo_url AS repo_url, r.source_path AS repo_source_path,
      substr(sr.response_text, 1, 600) AS response_head
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sr.job_id = sj.id
    LEFT JOIN repos r ON sr.repo_id = r.id
    WHERE sr.status IN ('completed', 'failed') AND sr.viewed_at IS NULL
    ORDER BY (sr.status = 'failed') DESC, sr.finished_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(limit) as UnreadScheduleRunRow[]
  return rows.map((row) => ({
    ...rowToScheduleRunWithContext(row),
    preview: extractReportPreview(row.status === 'failed' ? row.error_text : row.response_head),
  }))
}

export function countUnreadScheduleRuns(db: Database): { total: number; failed: number } {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM schedule_runs
    WHERE status IN ('completed', 'failed') AND viewed_at IS NULL
  `)
  const row = stmt.get() as { total: number; failed: number }
  return { total: Number(row.total), failed: Number(row.failed) }
}

export function markScheduleRunViewed(db: Database, runId: number): boolean {
  const result = db
    .prepare("UPDATE schedule_runs SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL AND status IN ('completed', 'failed')")
    .run(Date.now(), runId)
  return result.changes > 0
}

export function markAllScheduleRunsViewed(db: Database): number {
  const result = db
    .prepare("UPDATE schedule_runs SET viewed_at = ? WHERE viewed_at IS NULL AND status IN ('completed', 'failed')")
    .run(Date.now())
  return result.changes
}
