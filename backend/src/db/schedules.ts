import type { Database } from 'bun:sqlite'
import {
  LOCAL_OPENCODE_SERVER_ID,
  ScheduleJobSchema,
  ScheduleMcpServersSchema,
  ScheduleModeSchema,
  SchedulePermissionConfigSchema,
  ScheduleRunSchema,
  ScheduleRunStatusSchema,
  ScheduleSandboxConfigSchema,
  ScheduleSkillMetadataSchema,
  ScheduleWorkspaceModeSchema,
  type ScheduleJob,
  type ScheduleMcpServer,
  type SchedulePermissionConfig,
  type ScheduleRun,
  type ScheduleRunStatus,
  type ScheduleRunTriggerSource,
  type ScheduleSandboxConfig,
  type ScheduleWorkspaceMode,
} from '@opencode-manager/shared/schemas'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME, ASSISTANT_REPO_PATH, getRepoDisplayName } from '@opencode-manager/shared/utils'
import type { ScheduleJobPersistenceInput } from '../services/schedule-config'
import { z } from 'zod'
import { selectRow, selectRows } from './rows'

const ScheduleJobRowSchema = z.object({
  id: z.number(),
  repo_id: z.number().nullable(),
  server_id: z.string().nullish(),
  directory: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  enabled: z.number(),
  show_in_inbox: z.number().nullish(),
  schedule_mode: ScheduleModeSchema.nullish(),
  interval_minutes: z.number().nullish(),
  cron_expression: z.string().nullish(),
  timezone: z.string().nullish(),
  agent_slug: z.string().nullish(),
  prompt: z.string(),
  model: z.string().nullish(),
  skill_metadata: z.string().nullish(),
  permission_config: z.string().nullish(),
  mcp_servers: z.string().nullish(),
  branch: z.string().nullish(),
  workspace_mode: z.string().nullish(),
  sandbox_config: z.string().nullish(),
  created_at: z.number(),
  updated_at: z.number(),
  last_run_at: z.number().nullish(),
  next_run_at: z.number().nullish(),
})

type ScheduleJobRow = z.infer<typeof ScheduleJobRowSchema>

const ScheduleRunRowSchema = z.object({
  id: z.number(),
  job_id: z.number(),
  repo_id: z.number().nullable(),
  server_id: z.string().nullish(),
  trigger_source: z.string(),
  status: z.string(),
  started_at: z.number(),
  finished_at: z.number().nullish(),
  viewed_at: z.number().nullish(),
  created_at: z.number(),
  session_id: z.string().nullish(),
  session_title: z.string().nullish(),
  log_text: z.string().nullish(),
  response_text: z.string().nullish(),
  error_text: z.string().nullish(),
  run_branch: z.string().nullish(),
  commit_hash: z.string().nullish(),
  worktree_path: z.string().nullish(),
})

type ScheduleRunRow = z.infer<typeof ScheduleRunRowSchema>

const ScheduleJobIdRowSchema = z.object({ id: z.number() })

const ScheduleRunArtifactRowSchema = z.object({
  id: z.number(),
  status: ScheduleRunStatusSchema,
  run_branch: z.string().nullable(),
  worktree_path: z.string().nullable(),
})

const ScheduleJobWorktreeOwnerRowSchema = z.object({
  id: z.number(),
  repo_id: z.number(),
  name: z.string(),
})

const ShowInInboxRowSchema = z.object({ show_in_inbox: z.number() })

const UnreadScheduleRunCountRowSchema = z.object({ total: z.number(), failed: z.number() })

function parseSkillMetadata(raw: string | null | undefined) {
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

function parsePermissionConfig(raw: string | null | undefined): SchedulePermissionConfig | null {
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

function parseMcpServers(raw: string | null | undefined): ScheduleMcpServer[] {
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

function parseSandboxConfig(raw: string | null | undefined): ScheduleSandboxConfig | null {
  if (!raw) {
    return null
  }

  try {
    const result = ScheduleSandboxConfigSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function normalizeWorkspaceMode(raw: string | null | undefined): ScheduleWorkspaceMode {
  const result = ScheduleWorkspaceModeSchema.safeParse(raw)
  return result.success ? result.data : 'worktree'
}

function rowToScheduleJob(row: ScheduleJobRow): ScheduleJob {
  return ScheduleJobSchema.parse({
    id: row.id,
    repoId: row.repo_id,
    serverId: row.server_id ?? 'local',
    directory: row.directory ?? null,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    showInInbox: row.show_in_inbox !== 0,
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
    workspaceMode: normalizeWorkspaceMode(row.workspace_mode),
    sandbox: parseSandboxConfig(row.sandbox_config),
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
    serverId: row.server_id ?? 'local',
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

function serializeSandboxConfig(sandbox: ScheduleJobPersistenceInput['sandbox']): string | null {
  return sandbox ? JSON.stringify(sandbox) : null
}

export function listScheduleJobsByRepo(db: Database, repoId: number): ScheduleJob[] {
  const rows = selectRows(db, ScheduleJobRowSchema, 'SELECT * FROM schedule_jobs WHERE repo_id IS ? ORDER BY created_at DESC', repoId)
  return rows.map(rowToScheduleJob)
}

export function listScheduleJobsByServer(db: Database, serverId: string): ScheduleJob[] {
  const rows = selectRows(db, ScheduleJobRowSchema, 'SELECT * FROM schedule_jobs WHERE server_id = ? ORDER BY created_at DESC', serverId)
  return rows.map(rowToScheduleJob)
}

export function listScheduleJobIdsByRepo(db: Database, repoId: number): number[] {
  const rows = selectRows(db, ScheduleJobIdRowSchema, 'SELECT id FROM schedule_jobs WHERE repo_id IS ? ORDER BY created_at DESC', repoId)
  return rows.map((row) => row.id)
}

export function listEnabledScheduleJobs(db: Database): ScheduleJob[] {
  const rows = selectRows(db, ScheduleJobRowSchema, 'SELECT * FROM schedule_jobs WHERE enabled = 1 ORDER BY id ASC')
  return rows.map(rowToScheduleJob)
}

export function getScheduleJobById(db: Database, repoId: number | null, jobId: number): ScheduleJob | null {
  const row = selectRow(db, ScheduleJobRowSchema, 'SELECT * FROM schedule_jobs WHERE repo_id IS ? AND id = ?', repoId, jobId)
  return row ? rowToScheduleJob(row) : null
}

export function createScheduleJob(
  db: Database,
  repoId: number | null,
  input: ScheduleJobPersistenceInput,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): ScheduleJob {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO schedule_jobs (
      repo_id, server_id, directory, name, description, enabled, show_in_inbox, schedule_mode, interval_minutes, cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
      permission_config,
      mcp_servers,
      branch,
      workspace_mode,
      sandbox_config,
      created_at, updated_at, last_run_at, next_run_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    repoId,
    serverId,
    input.directory ?? null,
    input.name,
    input.description ?? null,
    input.enabled ? 1 : 0,
    input.showInInbox ? 1 : 0,
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
    input.workspaceMode,
    serializeSandboxConfig(input.sandbox),
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

export function updateScheduleJob(db: Database, repoId: number | null, jobId: number, input: ScheduleJobPersistenceInput): ScheduleJob | null {
  const existing = getScheduleJobById(db, repoId, jobId)
  if (!existing) {
    return null
  }

  const now = Date.now()

  const stmt = db.prepare(`
    UPDATE schedule_jobs
    SET name = ?, description = ?, enabled = ?, show_in_inbox = ?, schedule_mode = ?, interval_minutes = ?, cron_expression = ?, timezone = ?,
        agent_slug = ?, prompt = ?, model = ?, skill_metadata = ?, permission_config = ?, mcp_servers = ?, branch = ?, workspace_mode = ?, sandbox_config = ?, directory = ?, updated_at = ?, next_run_at = ?
    WHERE repo_id IS ? AND id = ?
  `)

  stmt.run(
    input.name,
    input.description,
    input.enabled ? 1 : 0,
    input.showInInbox ? 1 : 0,
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
    input.workspaceMode,
    serializeSandboxConfig(input.sandbox),
    input.directory ?? null,
    now,
    input.nextRunAt,
    repoId,
    jobId,
  )

  return getScheduleJobById(db, repoId, jobId)
}

export function deleteScheduleJob(db: Database, repoId: number | null, jobId: number): boolean {
  db.prepare('DELETE FROM schedule_runs WHERE repo_id IS ? AND job_id = ?').run(repoId, jobId)
  const stmt = db.prepare('DELETE FROM schedule_jobs WHERE repo_id IS ? AND id = ?')
  const result = stmt.run(repoId, jobId)
  return result.changes > 0
}

export interface ScheduleRunArtifact {
  id: number
  status: ScheduleRunStatus
  runBranch: string | null
  worktreePath: string | null
}

export function listScheduleRunArtifactsByJob(db: Database, repoId: number | null, jobId: number): ScheduleRunArtifact[] {
  const rows = selectRows(
    db,
    ScheduleRunArtifactRowSchema,
    'SELECT id, status, run_branch, worktree_path FROM schedule_runs WHERE repo_id IS ? AND job_id = ? ORDER BY id DESC',
    repoId,
    jobId,
  )
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    runBranch: row.run_branch,
    worktreePath: row.worktree_path,
  }))
}

export interface ScheduleJobWorktreeOwner {
  id: number
  repoId: number
  name: string
}

export function listScheduleJobWorktreeOwners(db: Database): ScheduleJobWorktreeOwner[] {
  const rows = selectRows(db, ScheduleJobWorktreeOwnerRowSchema, 'SELECT id, repo_id, name FROM schedule_jobs WHERE repo_id IS NOT NULL')
  return rows.map((row) => ({ id: row.id, repoId: row.repo_id, name: row.name }))
}

export function clearScheduleRunWorktreePath(db: Database, repoId: number | null, jobId: number, worktreePath: string): number {
  return db
    .prepare('UPDATE schedule_runs SET worktree_path = NULL WHERE repo_id IS ? AND job_id = ? AND worktree_path = ?')
    .run(repoId, jobId, worktreePath).changes
}

export function deleteScheduleRunById(db: Database, repoId: number | null, jobId: number, runId: number): boolean {
  const result = db
    .prepare('DELETE FROM schedule_runs WHERE repo_id IS ? AND job_id = ? AND id = ?')
    .run(repoId, jobId, runId)
  return result.changes > 0
}

export function deleteScheduleRunsByIds(db: Database, repoId: number | null, jobId: number, runIds: number[]): number {
  if (runIds.length === 0) return 0
  const placeholders = runIds.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM schedule_runs WHERE repo_id IS ? AND job_id = ? AND id IN (${placeholders})`)
    .run(repoId, jobId, ...runIds)
  return result.changes
}

export interface OrphanedScheduleCleanup {
  orphanedJobs: number
  orphanedRuns: number
}

export function cleanupOrphanedSchedules(db: Database): OrphanedScheduleCleanup {
  const runStmt = db.prepare(`
    DELETE FROM schedule_runs
    WHERE (repo_id IS NOT NULL AND repo_id != ? AND repo_id NOT IN (SELECT id FROM repos))
       OR job_id NOT IN (SELECT id FROM schedule_jobs)
  `)
  const orphanedRuns = runStmt.run(ASSISTANT_REPO_ID).changes

  const jobStmt = db.prepare(`
    DELETE FROM schedule_jobs
    WHERE repo_id IS NOT NULL AND repo_id != ? AND repo_id NOT IN (SELECT id FROM repos)
  `)
  const orphanedJobs = jobStmt.run(ASSISTANT_REPO_ID).changes

  return { orphanedJobs, orphanedRuns }
}

export function updateScheduleJobRunState(db: Database, repoId: number | null, jobId: number, values: { lastRunAt: number; nextRunAt?: number | null }): void {
  const stmt = db.prepare('UPDATE schedule_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE repo_id IS ? AND id = ?')
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
    repoId: number | null
    serverId?: string
    triggerSource: ScheduleRunTriggerSource
    status: ScheduleRunStatus
    startedAt: number
    createdAt: number
  },
): ScheduleRun {
  const stmt = db.prepare(`
    INSERT INTO schedule_runs (job_id, repo_id, server_id, trigger_source, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    input.jobId,
    input.repoId,
    input.serverId ?? LOCAL_OPENCODE_SERVER_ID,
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
  repoId: number | null,
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
    SET status = ?, finished_at = ?,
        viewed_at = CASE
          WHEN ? = 'completed' AND EXISTS (
            SELECT 1 FROM schedule_jobs sj WHERE sj.id = schedule_runs.job_id AND sj.show_in_inbox = 0
          ) THEN ?
          ELSE viewed_at
        END,
        session_id = ?, session_title = ?, log_text = ?, response_text = ?, error_text = ?
    WHERE repo_id IS ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.status,
    input.finishedAt,
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
  repoId: number | null,
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
    WHERE repo_id IS ? AND job_id = ? AND id = ?
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
  repoId: number | null,
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
    WHERE repo_id IS ? AND job_id = ? AND id = ?
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

export function getScheduleRunById(db: Database, repoId: number | null, jobId: number, runId: number): ScheduleRun | null {
  const row = selectRow(db, ScheduleRunRowSchema, 'SELECT * FROM schedule_runs WHERE repo_id IS ? AND job_id = ? AND id = ?', repoId, jobId, runId)
  return row ? rowToScheduleRun(row) : null
}

export function getScheduleRunBySessionId(
  db: Database,
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): ScheduleRun | null {
  const row = selectRow(
    db,
    ScheduleRunRowSchema,
    'SELECT * FROM schedule_runs WHERE server_id = ? AND session_id = ? ORDER BY started_at DESC LIMIT 1',
    serverId,
    sessionId,
  )
  return row ? rowToScheduleRun(row) : null
}

export function isQuietScheduleRunSession(
  db: Database,
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): boolean {
  const row = selectRow(
    db,
    ShowInInboxRowSchema,
    `
    SELECT sj.show_in_inbox
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sj.id = sr.job_id
    WHERE sr.server_id = ? AND sr.session_id = ?
    ORDER BY sr.started_at DESC
    LIMIT 1
  `,
    serverId,
    sessionId,
  )
  return row?.show_in_inbox === 0
}

export function getRunningScheduleRunByJob(db: Database, repoId: number | null, jobId: number): ScheduleRun | null {
  const row = selectRow(
    db,
    ScheduleRunRowSchema,
    `
    SELECT * FROM schedule_runs
    WHERE repo_id IS ? AND job_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `,
    repoId,
    jobId,
  )
  return row ? rowToScheduleRun(row) : null
}

export function listRunningScheduleRuns(db: Database, limit: number = 100): ScheduleRun[] {
  const rows = selectRows(
    db,
    ScheduleRunRowSchema,
    `
    SELECT * FROM schedule_runs
    WHERE status = 'running'
    ORDER BY started_at ASC
    LIMIT ?
  `,
    limit,
  )
  return rows.map(rowToScheduleRun)
}

export function listScheduleRunsByJob(db: Database, repoId: number | null, jobId: number, limit: number = 20): ScheduleRun[] {
  const rows = selectRows(
    db,
    ScheduleRunRowSchema,
    `
    SELECT
      id,
      job_id,
      repo_id,
      server_id,
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
    WHERE repo_id IS ? AND job_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `,
    repoId,
    jobId,
    limit,
  )
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
  serverName: string | null
  lastRun: ScheduleRunSummary | null
}

const ScheduleJobWithRepoRowSchema = ScheduleJobRowSchema.extend({
  repo_url: z.string().nullish(),
  repo_path: z.string().nullish(),
  repo_name: z.string().nullish(),
  repo_source_path: z.string().nullish(),
  server_name: z.string().nullish(),
  last_run_id: z.number().nullish(),
  last_run_status: ScheduleRunStatusSchema.nullish(),
  last_run_started_at: z.number().nullish(),
  last_run_finished_at: z.number().nullish(),
  last_run_viewed_at: z.number().nullish(),
  last_run_error_text: z.string().nullish(),
  last_run_response_head: z.string().nullish(),
})

type ScheduleJobWithRepoRow = z.infer<typeof ScheduleJobWithRepoRowSchema>

const RepoDisplayRowSchema = z.object({
  repo_id: z.number().nullable(),
  repo_path: z.string().nullish(),
  repo_name: z.string().nullish(),
  repo_url: z.string().nullish(),
  repo_source_path: z.string().nullish(),
  directory: z.string().nullish(),
  server_name: z.string().nullish(),
})

type RepoDisplayRow = z.infer<typeof RepoDisplayRowSchema>

interface RepoDisplay {
  repoName: string
  repoPath: string
}

function resolveRepoDisplay(row: RepoDisplayRow): RepoDisplay {
  if (row.repo_id === null) {
    return { repoName: row.server_name ?? 'Linked server', repoPath: row.directory ?? '' }
  }
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
  const status = ScheduleRunStatusSchema.safeParse(row.last_run_status)
  if (!status.success) {
    return null
  }

  return {
    id: row.last_run_id,
    status: status.data,
    startedAt: row.last_run_started_at ?? 0,
    finishedAt: row.last_run_finished_at ?? null,
    viewedAt: row.last_run_viewed_at ?? null,
    preview: extractReportPreview(row.last_run_status === 'failed' ? row.last_run_error_text : row.last_run_response_head),
  }
}

function rowToScheduleJobWithRepo(row: ScheduleJobWithRepoRow): ScheduleJobWithRepo {
  return {
    ...rowToScheduleJob(row),
    ...resolveRepoDisplay(row),
    repoUrl: row.repo_url ?? '',
    serverName: row.server_name ?? null,
    lastRun: buildLastRunSummary(row),
  }
}

export function listAllScheduleJobsWithRepos(db: Database): ScheduleJobWithRepo[] {
  const rows = selectRows(db, ScheduleJobWithRepoRowSchema, `
    SELECT
      sj.*, r.repo_url, r.local_path as repo_path, r.name as repo_name, r.source_path as repo_source_path,
      os.name AS server_name,
      sr.id AS last_run_id,
      sr.status AS last_run_status,
      sr.started_at AS last_run_started_at,
      sr.finished_at AS last_run_finished_at,
      sr.viewed_at AS last_run_viewed_at,
      substr(sr.error_text, 1, 600) AS last_run_error_text,
      substr(sr.response_text, 1, 600) AS last_run_response_head
    FROM schedule_jobs sj
    LEFT JOIN repos r ON sj.repo_id = r.id
    LEFT JOIN opencode_servers os ON sj.server_id = os.id AND sj.server_id != 'local'
    LEFT JOIN schedule_runs sr ON sr.id = (
      SELECT id FROM schedule_runs WHERE job_id = sj.id ORDER BY started_at DESC LIMIT 1
    )
    ORDER BY COALESCE(r.local_path, sj.directory, ''), sj.name
  `)
  return rows.map(rowToScheduleJobWithRepo)
}

export interface ScheduleRunWithContext extends ScheduleRun {
  jobName: string
  repoName: string
  repoPath: string
  serverName: string | null
}

const ScheduleRunWithContextRowSchema = ScheduleRunRowSchema.extend({
  job_name: z.string(),
  repo_path: z.string().nullish(),
  repo_name: z.string().nullish(),
  repo_url: z.string().nullish(),
  repo_source_path: z.string().nullish(),
  directory: z.string().nullish(),
  server_name: z.string().nullish(),
})

type ScheduleRunWithContextRow = z.infer<typeof ScheduleRunWithContextRowSchema>

function rowToScheduleRunWithContext(row: ScheduleRunWithContextRow): ScheduleRunWithContext {
  return {
    ...rowToScheduleRun(row),
    jobName: row.job_name,
    serverName: row.server_name ?? null,
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
    const searchColumns = ['sj.name', 'sr.session_title', 'sr.error_text', 'sr.run_branch', 'r.name', 'r.local_path', 'sj.directory', 'os.name']
    conditions.push(`(${searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    params.push(...searchColumns.map(() => pattern))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  params.push(limit, offset)
  const rows = selectRows(
    db,
    ScheduleRunWithContextRowSchema,
    `
    SELECT
      sr.id, sr.job_id, sr.repo_id, sr.server_id, sr.trigger_source, sr.status,
      sr.started_at, sr.finished_at, sr.created_at,
      sr.session_id, sr.session_title,
      NULL AS log_text, NULL AS response_text, sr.error_text,
      sr.viewed_at,
      sr.run_branch, sr.commit_hash, sr.worktree_path,
      sj.name AS job_name, sj.directory AS directory, r.local_path AS repo_path, r.name AS repo_name,
      r.repo_url AS repo_url, r.source_path AS repo_source_path, os.name AS server_name
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sr.job_id = sj.id
    LEFT JOIN repos r ON sr.repo_id = r.id
    LEFT JOIN opencode_servers os ON sj.server_id = os.id AND sj.server_id != 'local'
    ${whereClause}
    ORDER BY sr.started_at DESC
    LIMIT ? OFFSET ?
  `,
    ...params,
  )
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

export function extractReportPreview(text: string | null | undefined): string | null {
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

const UnreadScheduleRunRowSchema = ScheduleRunWithContextRowSchema.extend({
  response_head: z.string().nullish(),
})

export function listUnreadScheduleRuns(db: Database, limit: number = 20): ScheduleRunWithUnreadPreview[] {
  const rows = selectRows(
    db,
    UnreadScheduleRunRowSchema,
    `
    SELECT
      sr.id, sr.job_id, sr.repo_id, sr.server_id, sr.trigger_source, sr.status,
      sr.started_at, sr.finished_at, sr.created_at,
      sr.session_id, sr.session_title, sr.viewed_at,
      NULL AS log_text, NULL AS response_text, sr.error_text,
      sr.run_branch, sr.commit_hash, sr.worktree_path,
      sj.name AS job_name, sj.directory AS directory, r.local_path AS repo_path, r.name AS repo_name,
      r.repo_url AS repo_url, r.source_path AS repo_source_path, os.name AS server_name,
      substr(sr.response_text, 1, 600) AS response_head
    FROM schedule_runs sr
    JOIN schedule_jobs sj ON sr.job_id = sj.id
    LEFT JOIN repos r ON sr.repo_id = r.id
    LEFT JOIN opencode_servers os ON sj.server_id = os.id AND sj.server_id != 'local'
    WHERE sr.status IN ('completed', 'failed') AND sr.viewed_at IS NULL
    ORDER BY (sr.status = 'failed') DESC, sr.finished_at DESC
    LIMIT ?
  `,
    limit,
  )
  return rows.map((row) => ({
    ...rowToScheduleRunWithContext(row),
    preview: extractReportPreview(row.status === 'failed' ? row.error_text : row.response_head),
  }))
}

export interface UnreadScheduleRunCount {
  total: number
  failed: number
}

export function countUnreadScheduleRuns(db: Database): UnreadScheduleRunCount {
  const row = selectRow(
    db,
    UnreadScheduleRunCountRowSchema,
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM schedule_runs
    WHERE status IN ('completed', 'failed') AND viewed_at IS NULL
  `,
  )
  return { total: Number(row?.total ?? 0), failed: Number(row?.failed ?? 0) }
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
