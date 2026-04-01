import type { Database } from 'bun:sqlite'
import {
  ScheduleJobSchema,
  ScheduleRunSchema,
  ScheduleSkillMetadataSchema,
  type ScheduleJob,
  type ScheduleMode,
  type ScheduleRun,
  type ScheduleRunStatus,
  type ScheduleRunTriggerSource,
} from '@opencode-manager/shared/schemas'
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
  created_at: number
  session_id: string | null
  session_title: string | null
  log_text: string | null
  response_text: string | null
  error_text: string | null
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
    createdAt: row.created_at,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    logText: row.log_text,
    responseText: row.response_text,
    errorText: row.error_text,
  })
}

function serializeSkillMetadata(skillMetadata: ScheduleJobPersistenceInput['skillMetadata']): string | null {
  if (!skillMetadata) {
    return null
  }

  return JSON.stringify(skillMetadata)
}

export function listScheduleJobsByRepo(db: Database, repoId: number): ScheduleJob[] {
  const stmt = db.prepare('SELECT * FROM schedule_jobs WHERE repo_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(repoId) as ScheduleJobRow[]
  return rows.map(rowToScheduleJob)
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
      created_at, updated_at, last_run_at, next_run_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    SET name = ?, description = ?, enabled = ?, schedule_mode = ?, interval_minutes = ?, cron_expression = ?, timezone = ?, agent_slug = ?, prompt = ?, model = ?, skill_metadata = ?, updated_at = ?, next_run_at = ?
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
    now,
    input.nextRunAt,
    repoId,
    jobId,
  )

  return getScheduleJobById(db, repoId, jobId)
}

export function deleteScheduleJob(db: Database, repoId: number, jobId: number): boolean {
  const stmt = db.prepare('DELETE FROM schedule_jobs WHERE repo_id = ? AND id = ?')
  const result = stmt.run(repoId, jobId)
  return result.changes > 0
}

export function reserveScheduleJobNextRun(db: Database, repoId: number, jobId: number, nextRunAt: number): void {
  const stmt = db.prepare('UPDATE schedule_jobs SET next_run_at = ?, updated_at = ? WHERE repo_id = ? AND id = ?')
  stmt.run(nextRunAt, Date.now(), repoId, jobId)
}

export function updateScheduleJobRunState(db: Database, repoId: number, jobId: number, values: { lastRunAt: number; nextRunAt?: number | null }): void {
  const stmt = db.prepare('UPDATE schedule_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE repo_id = ? AND id = ?')
  stmt.run(values.lastRunAt, values.nextRunAt ?? null, Date.now(), repoId, jobId)
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

export function getScheduleRunById(db: Database, repoId: number, jobId: number, runId: number): ScheduleRun | null {
  const stmt = db.prepare('SELECT * FROM schedule_runs WHERE repo_id = ? AND job_id = ? AND id = ?')
  const row = stmt.get(repoId, jobId, runId) as ScheduleRunRow | undefined
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
      created_at,
      session_id,
      session_title,
      NULL AS log_text,
      NULL AS response_text,
      error_text
    FROM schedule_runs
    WHERE repo_id = ? AND job_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(repoId, jobId, limit) as ScheduleRunRow[]
  return rows.map(rowToScheduleRun)
}

export interface ScheduleJobWithRepo extends ScheduleJob {
  repoName: string
  repoPath: string
  repoUrl: string
}

interface ScheduleJobWithRepoRow extends ScheduleJobRow {
  repo_url: string
  repo_path: string
}

function repoNameFromPath(repoPath: string): string {
  if (!repoPath || repoPath === '/') return 'Unknown'
  return repoPath.split(/[\\/]/).pop() ?? repoPath
}

function rowToScheduleJobWithRepo(row: ScheduleJobWithRepoRow): ScheduleJobWithRepo {
  const job = rowToScheduleJob(row)
  return {
    ...job,
    repoName: repoNameFromPath(row.repo_path),
    repoPath: row.repo_path,
    repoUrl: row.repo_url,
  }
}

export function listAllScheduleJobsWithRepos(db: Database): ScheduleJobWithRepo[] {
  const stmt = db.prepare(`
    SELECT sj.*, r.repo_url, r.local_path as repo_path
    FROM schedule_jobs sj
    JOIN repos r ON sj.repo_id = r.id
    ORDER BY r.local_path, sj.name
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
  repo_path: string
}

function rowToScheduleRunWithContext(row: ScheduleRunWithContextRow): ScheduleRunWithContext {
  const run = rowToScheduleRun(row)
  return {
    ...run,
    jobName: row.job_name,
    repoName: repoNameFromPath(row.repo_path),
    repoPath: row.repo_path,
  }
}

export interface ListAllRunsOptions {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
}

export function listAllScheduleRuns(db: Database, options: ListAllRunsOptions = {}): ScheduleRunWithContext[] {
  const { limit = 50, offset = 0, status, repoId, jobId, triggerSource } = options
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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const stmt = db.prepare(`
    SELECT
      sr.id, sr.job_id, sr.repo_id, sr.trigger_source, sr.status,
      sr.started_at, sr.finished_at, sr.created_at,
      sr.session_id, sr.session_title,
      NULL AS log_text, NULL AS response_text, sr.error_text,
      sj.name AS job_name, r.local_path AS repo_path
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sr.job_id = sj.id
    JOIN repos r ON sr.repo_id = r.id
    ${whereClause}
    ORDER BY sr.started_at DESC
    LIMIT ? OFFSET ?
  `)

  params.push(limit, offset)
  const rows = stmt.all(...params) as ScheduleRunWithContextRow[]
  return rows.map(rowToScheduleRunWithContext)
}
