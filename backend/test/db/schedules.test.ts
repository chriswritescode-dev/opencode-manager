import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import type {
  ScheduleJob,
  ScheduleRun,
  ScheduleRunStatus,
  ScheduleRunTriggerSource,
} from '@opencode-manager/shared/schemas'
import * as schedulesDb from '../../src/db/schedules'
import type { ScheduleJobPersistenceInput } from '../../src/services/schedule-config'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'

const JOB_INPUT: ScheduleJobPersistenceInput = {
  name: 'Weekly engineering summary',
  description: 'Summarize repo health and recent changes.',
  enabled: true,
  showInInbox: true,
  scheduleMode: 'cron',
  intervalMinutes: null,
  cronExpression: '0 9 * * 1',
  timezone: 'UTC',
  agentSlug: 'planner',
  prompt: 'Generate a weekly summary.',
  model: 'openai/gpt-5-mini',
  skillMetadata: { skillSlugs: ['planning'], notes: 'Optional notes' },
  permissionConfig: { allowExternalDirectory: true, allowQuestions: false, bashDenyPatterns: ['rm -rf *'] },
  mcpServers: [{ name: 'kitchen' }],
  branch: null,
  workspaceMode: 'worktree',
  sandbox: { enabled: true, resources: null },
  nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
}

function jobInput(overrides: Partial<ScheduleJobPersistenceInput> = {}): ScheduleJobPersistenceInput {
  return { ...JOB_INPUT, ...overrides }
}

function startRun(
  db: Database,
  job: ScheduleJob,
  options: {
    triggerSource?: ScheduleRunTriggerSource
    status?: ScheduleRunStatus
    startedAt?: number
    serverId?: string
    sessionId?: string | null
  } = {},
): ScheduleRun {
  const startedAt = options.startedAt ?? 1_000
  const run = schedulesDb.createScheduleRun(db, {
    jobId: job.id,
    repoId: job.repoId,
    serverId: options.serverId,
    triggerSource: options.triggerSource ?? 'schedule',
    status: options.status ?? 'running',
    startedAt,
    createdAt: startedAt,
  })
  if (options.sessionId !== undefined) {
    schedulesDb.updateScheduleRunMetadata(db, job.repoId, job.id, run.id, { sessionId: options.sessionId })
  }
  return run
}

describe('schedule database queries', () => {
  let db: Database
  let repoId: number
  let otherRepoId: number

  beforeEach(() => {
    db = createTestDatabase()
    repoId = seedRepo(db, { repoUrl: 'https://github.com/test/my-repo' }).id
    otherRepoId = seedRepo(db, { repoUrl: 'https://github.com/test/other-repo' }).id
  })

  afterEach(() => {
    db.close()
  })

  describe('jobs', () => {
    it('lists schedule jobs and parses persisted metadata', () => {
      const created = seedScheduleJob(db, repoId, {
        scheduleMode: 'cron',
        intervalMinutes: null,
        cronExpression: '0 9 * * 1',
        skillMetadata: { skillSlugs: ['planning'], notes: 'Optional notes' },
      })
      seedScheduleJob(db, otherRepoId)

      const jobs = schedulesDb.listScheduleJobsByRepo(db, repoId)

      expect(jobs.map((job) => job.id)).toEqual([created.id])
      expect(jobs[0]).toMatchObject({
        repoId,
        scheduleMode: 'cron',
        skillMetadata: { skillSlugs: ['planning'], notes: 'Optional notes' },
      })
    })

    it('lists schedule job ids for one repository', () => {
      const first = seedScheduleJob(db, repoId)
      const second = seedScheduleJob(db, repoId)
      seedScheduleJob(db, otherRepoId)

      expect(schedulesDb.listScheduleJobIdsByRepo(db, repoId).sort()).toEqual([first.id, second.id].sort())
    })

    it('gets a schedule job by id, including legacy workspace modes and missing rows', () => {
      const job = seedScheduleJob(db, repoId, { workspaceMode: 'worktree' })
      db.prepare("UPDATE schedule_jobs SET workspace_mode = 'repo' WHERE id = ?").run(job.id)

      expect(schedulesDb.getScheduleJobById(db, repoId, job.id)).toMatchObject({
        id: job.id,
        repoId,
        name: job.name,
        branch: 'main',
        workspaceMode: 'worktree',
      })
      expect(schedulesDb.getScheduleJobById(db, repoId, 999)).toBeNull()
    })

    it('creates a schedule job and persists every field', () => {
      const created = schedulesDb.createScheduleJob(db, repoId, jobInput())

      expect(created).toMatchObject(jobInput())
      expect(created.id).toBeGreaterThan(0)
      expect(created.repoId).toBe(repoId)
      expect(created.serverId).toBe('local')
      expect(created.directory).toBeNull()
      expect(created.lastRunAt).toBeNull()
      expect(created.createdAt).toBe(created.updatedAt)
    })

    it('updates a schedule job and returns null for a missing one', () => {
      const created = seedScheduleJob(db, repoId)

      const updated = schedulesDb.updateScheduleJob(db, repoId, created.id, {
        ...jobInput(),
        name: 'Updated summary',
        enabled: false,
        showInInbox: false,
        skillMetadata: null,
      })

      expect(updated).toMatchObject({ name: 'Updated summary', enabled: false, showInInbox: false, skillMetadata: null })
      expect(schedulesDb.getScheduleJobById(db, repoId, created.id)).toEqual(updated)
      expect(schedulesDb.updateScheduleJob(db, repoId, 999, jobInput())).toBeNull()
    })

    it('lists only enabled jobs ordered by id', () => {
      const enabled = seedScheduleJob(db, repoId)
      seedScheduleJob(db, otherRepoId, { enabled: false })

      const jobs = schedulesDb.listEnabledScheduleJobs(db)

      expect(jobs.map((job) => job.id)).toEqual([enabled.id])
    })

    it('lists worktree owners only for repository jobs', () => {
      const local = seedScheduleJob(db, repoId)
      seedScheduleJob(db, null)

      expect(schedulesDb.listScheduleJobWorktreeOwners(db)).toEqual([{ id: local.id, repoId, name: local.name }])
    })

    it('updates the run state of a schedule job', () => {
      const job = seedScheduleJob(db, repoId)
      const lastRunAt = Date.now()
      const nextRunAt = lastRunAt + 3_600_000

      schedulesDb.updateScheduleJobRunState(db, repoId, job.id, { lastRunAt, nextRunAt })

      expect(schedulesDb.getScheduleJobById(db, repoId, job.id)).toMatchObject({ lastRunAt, nextRunAt })
    })

    it('deletes the runs of a job before deleting the job', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)

      expect(schedulesDb.deleteScheduleJob(db, repoId, job.id)).toBe(true)
      expect(schedulesDb.getScheduleJobById(db, repoId, job.id)).toBeNull()
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, run.id)).toBeNull()
      expect(schedulesDb.deleteScheduleJob(db, repoId, job.id)).toBe(false)
    })
  })

  describe('runs', () => {
    it('creates and reloads a schedule run', () => {
      const job = seedScheduleJob(db, repoId)

      const run = startRun(db, job, { triggerSource: 'manual', startedAt: 5_000 })

      expect(run.id).toBeGreaterThan(0)
      expect(run).toMatchObject({
        jobId: job.id,
        repoId,
        triggerSource: 'manual',
        status: 'running',
        startedAt: 5_000,
        finishedAt: null,
        sessionId: null,
      })
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, run.id)).toEqual(run)
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, 999)).toBeNull()
    })

    it('updates a schedule run and reloads the result', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)

      const updated = schedulesDb.updateScheduleRun(db, repoId, job.id, run.id, {
        status: 'completed',
        finishedAt: 5_000,
        sessionId: 'ses-1',
        sessionTitle: 'Updated title',
        logText: 'Log output',
        responseText: 'Completed',
        errorText: null,
      })

      expect(updated).toMatchObject({
        status: 'completed',
        finishedAt: 5_000,
        sessionId: 'ses-1',
        sessionTitle: 'Updated title',
        logText: 'Log output',
        responseText: 'Completed',
        errorText: null,
      })
    })

    it('returns null when updating metadata for a missing run', () => {
      const job = seedScheduleJob(db, repoId)

      expect(schedulesDb.updateScheduleRunMetadata(db, repoId, job.id, 999, { sessionTitle: 'Updated title' })).toBeNull()
    })

    it('updates schedule run metadata while preserving omitted fields', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)
      schedulesDb.updateScheduleRunMetadata(db, repoId, job.id, run.id, {
        sessionId: 'ses-1',
        logText: 'Run started.',
        responseText: 'Existing response',
        errorText: 'Existing error',
      })

      const updated = schedulesDb.updateScheduleRunMetadata(db, repoId, job.id, run.id, { sessionTitle: 'Updated title' })

      expect(updated).toMatchObject({
        sessionId: 'ses-1',
        sessionTitle: 'Updated title',
        logText: 'Run started.',
        responseText: 'Existing response',
        errorText: 'Existing error',
      })
    })

    it('returns null when updating worktree for a missing run', () => {
      const job = seedScheduleJob(db, repoId)

      expect(schedulesDb.updateScheduleRunWorktree(db, repoId, job.id, 999, { worktreePath: '/worktrees/feature-branch' })).toBeNull()
    })

    it('updates worktree fields while preserving omitted ones', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)
      schedulesDb.updateScheduleRunWorktree(db, repoId, job.id, run.id, { runBranch: 'feature-x' })

      const updated = schedulesDb.updateScheduleRunWorktree(db, repoId, job.id, run.id, {
        worktreePath: '/worktrees/feature-branch',
      })

      expect(updated).toMatchObject({ worktreePath: '/worktrees/feature-branch', runBranch: 'feature-x' })
    })

    it('lists running runs without the finished ones', () => {
      const job = seedScheduleJob(db, repoId)
      const first = startRun(db, job, { startedAt: 1_000 })
      const second = startRun(db, job, { startedAt: 2_000 })
      const finished = startRun(db, job, { startedAt: 3_000 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, finished.id, { status: 'completed', finishedAt: 4_000 })

      expect(schedulesDb.listRunningScheduleRuns(db).map((run) => run.id)).toEqual([first.id, second.id])
      expect(schedulesDb.listRunningScheduleRuns(db, 1).map((run) => run.id)).toEqual([first.id])
    })

    it('lists run summaries without loading log or response blobs', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)
      schedulesDb.updateScheduleRun(db, repoId, job.id, run.id, {
        status: 'failed',
        finishedAt: 2_000,
        responseText: 'Long response text',
        logText: 'Long log text',
        errorText: 'Run failed',
      })

      const runs = schedulesDb.listScheduleRunsByJob(db, repoId, job.id)

      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ id: run.id, logText: null, responseText: null, errorText: 'Run failed' })
    })

    it('returns the latest running run for a job', () => {
      const job = seedScheduleJob(db, repoId)
      const older = startRun(db, job, { startedAt: 1_000 })
      const newer = startRun(db, job, { startedAt: 2_000 })

      expect(schedulesDb.getRunningScheduleRunByJob(db, repoId, job.id)?.id).toBe(newer.id)

      schedulesDb.updateScheduleRun(db, repoId, job.id, newer.id, { status: 'completed', finishedAt: 3_000 })

      expect(schedulesDb.getRunningScheduleRunByJob(db, repoId, job.id)?.id).toBe(older.id)
    })

    it('scopes the session lookup by server and defaults to the local server', () => {
      const localJob = seedScheduleJob(db, repoId)
      const remoteJob = seedScheduleJob(db, repoId)
      startRun(db, localJob, { sessionId: 'ses_local' })
      const remote = startRun(db, remoteJob, { serverId: 'srv_kitchen', sessionId: 'ses_remote' })

      expect(schedulesDb.getScheduleRunBySessionId(db, 'ses_local')).toMatchObject({ sessionId: 'ses_local', serverId: 'local' })
      expect(schedulesDb.getScheduleRunBySessionId(db, 'ses_remote', 'srv_kitchen')?.id).toBe(remote.id)
      expect(schedulesDb.getScheduleRunBySessionId(db, 'ses_remote')).toBeNull()
    })

    it('lists run artifacts by job in reverse id order', () => {
      const job = seedScheduleJob(db, repoId)
      const first = startRun(db, job, { startedAt: 1_000 })
      const second = startRun(db, job, { startedAt: 2_000 })
      schedulesDb.updateScheduleRunWorktree(db, repoId, job.id, first.id, { runBranch: 'schedule/7/run-1' })
      schedulesDb.updateScheduleRunWorktree(db, repoId, job.id, second.id, {
        runBranch: 'schedule/7/run-2',
        worktreePath: '/wt/2',
      })
      schedulesDb.updateScheduleRun(db, repoId, job.id, first.id, { status: 'completed', finishedAt: 3_000 })

      expect(schedulesDb.listScheduleRunArtifactsByJob(db, repoId, job.id)).toEqual([
        { id: second.id, status: 'running', runBranch: 'schedule/7/run-2', worktreePath: '/wt/2' },
        { id: first.id, status: 'completed', runBranch: 'schedule/7/run-1', worktreePath: null },
      ])
    })

    it('deletes a single run', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)

      expect(schedulesDb.deleteScheduleRunById(db, repoId, job.id, run.id)).toBe(true)
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, run.id)).toBeNull()
      expect(schedulesDb.deleteScheduleRunById(db, repoId, job.id, run.id)).toBe(false)
    })

    it('deletes only the given run ids', () => {
      const job = seedScheduleJob(db, repoId)
      const first = startRun(db, job, { startedAt: 1_000 })
      const second = startRun(db, job, { startedAt: 2_000 })
      const third = startRun(db, job, { startedAt: 3_000 })

      expect(schedulesDb.deleteScheduleRunsByIds(db, repoId, job.id, [third.id, first.id])).toBe(2)
      expect(schedulesDb.listScheduleRunsByJob(db, repoId, job.id).map((run) => run.id)).toEqual([second.id])
    })

    it('is a no-op when deleting no run ids', () => {
      const job = seedScheduleJob(db, repoId)
      startRun(db, job)

      expect(schedulesDb.deleteScheduleRunsByIds(db, repoId, job.id, [])).toBe(0)
      expect(schedulesDb.listScheduleRunsByJob(db, repoId, job.id)).toHaveLength(1)
    })
  })

  describe('run listings with context', () => {
    function seedContextRuns() {
      const job = seedScheduleJob(db, repoId, { name: 'Alpha job' })
      const remoteJob = seedScheduleJob(db, otherRepoId, { name: 'Beta job' })
      seedContextRunsForJob(job)
      seedContextRunsForJob(remoteJob)
      return { job, remoteJob }
    }

    function seedContextRunsForJob(job: ScheduleJob): void {
      startRun(db, job, { startedAt: 1_000 })
      const failed = startRun(db, job, { startedAt: 2_000 })
      schedulesDb.updateScheduleRun(db, job.repoId, job.id, failed.id, { status: 'failed', finishedAt: 2_500 })
      startRun(db, job, { triggerSource: 'manual', startedAt: 3_000 })
    }

    it('maps job and repo context onto runs', () => {
      seedContextRuns()

      const runs = schedulesDb.listAllScheduleRuns(db)
      const betaRun = runs.find((run) => run.jobName === 'Beta job')

      expect(runs).toHaveLength(6)
      expect(betaRun).toMatchObject({
        repoName: 'other-repo',
        repoPath: expect.any(String),
        logText: null,
        responseText: null,
      })
    })

    const filterCases: Array<{ label: string; build: (job: ScheduleJob) => schedulesDb.ListAllRunsOptions; expected: number }> = [
      { label: 'status', build: () => ({ status: 'failed' }), expected: 2 },
      { label: 'repo', build: (job) => ({ repoId: job.repoId ?? 0 }), expected: 3 },
      { label: 'job', build: (job) => ({ jobId: job.id }), expected: 3 },
      { label: 'trigger source', build: () => ({ triggerSource: 'manual' }), expected: 2 },
      { label: 'run id', build: () => ({ runId: 1 }), expected: 1 },
      { label: 'combined filters', build: (job) => ({ repoId: job.repoId ?? 0, runId: 1 }), expected: 1 },
    ]

    it.each(filterCases)('filters runs by $label', ({ build, expected }) => {
      const { job } = seedContextRuns()

      const result = schedulesDb.listAllScheduleRuns(db, build(job))

      expect(result).toHaveLength(expected)
    })

    it('treats a search term literally and ignores a blank one', () => {
      const job = seedScheduleJob(db, repoId, { name: '50%_off job' })
      const otherJob = seedScheduleJob(db, otherRepoId, { name: '500off job' })
      startRun(db, job)
      startRun(db, otherJob)

      expect(schedulesDb.listAllScheduleRuns(db, { search: '  50%_off  ' }).map((run) => run.jobId)).toEqual([job.id])
      expect(schedulesDb.listAllScheduleRuns(db, { search: '   ' })).toHaveLength(2)
    })

    it('applies limit and offset', () => {
      const job = seedScheduleJob(db, repoId)
      const first = startRun(db, job, { startedAt: 1_000 })
      const second = startRun(db, job, { startedAt: 2_000 })
      const third = startRun(db, job, { startedAt: 3_000 })

      expect(schedulesDb.listAllScheduleRuns(db, { limit: 1, offset: 1 }).map((run) => run.id)).toEqual([second.id])
      expect(schedulesDb.listAllScheduleRuns(db, { limit: 10 }).map((run) => run.id)).toEqual([third.id, second.id, first.id])
    })

    it('maps the latest run onto jobs with repo context', () => {
      const job = seedScheduleJob(db, repoId, { name: 'Alpha job' })
      seedScheduleJob(db, repoId, { name: 'Beta job' })
      const run = startRun(db, job, { startedAt: 1_000 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, run.id, { status: 'failed', finishedAt: 2_000, errorText: 'Model unavailable' })

      const jobs = schedulesDb.listAllScheduleJobsWithRepos(db)
      const withRun = jobs.find((entry) => entry.id === job.id)
      const withoutRun = jobs.find((entry) => entry.name === 'Beta job')

      expect(withRun?.lastRun).toEqual({
        id: run.id,
        status: 'failed',
        startedAt: 1_000,
        finishedAt: 2_000,
        viewedAt: null,
        preview: 'Model unavailable',
      })
      expect(withoutRun?.lastRun).toBeNull()
    })

    it('lists unread finished runs with a preview, failed first', () => {
      const job = seedScheduleJob(db, repoId)
      const completed = startRun(db, job, { startedAt: 1_000 })
      const failed = startRun(db, job, { startedAt: 2_000 })
      const running = startRun(db, job, { startedAt: 3_000 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, completed.id, {
        status: 'completed',
        finishedAt: 1_500,
        responseText: '## Summary\nEverything is stable.',
      })
      schedulesDb.updateScheduleRun(db, repoId, job.id, failed.id, {
        status: 'failed',
        finishedAt: 2_500,
        errorText: 'Deploy failed\nsee logs',
      })

      const runs = schedulesDb.listUnreadScheduleRuns(db)

      expect(runs.map((run) => run.id)).toEqual([failed.id, completed.id])
      expect(runs.map((run) => run.preview)).toEqual(['Deploy failed', 'Summary'])
      expect(runs.map((run) => run.id)).not.toContain(running.id)
    })

    it('counts unread finished runs', () => {
      const job = seedScheduleJob(db, repoId)
      const completed = startRun(db, job, { startedAt: 1_000 })
      const failed = startRun(db, job, { startedAt: 2_000 })
      const running = startRun(db, job, { startedAt: 3_000 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, completed.id, { status: 'completed', finishedAt: 1_500 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, failed.id, { status: 'failed', finishedAt: 2_500 })

      expect(schedulesDb.countUnreadScheduleRuns(db)).toEqual({ total: 2, failed: 1 })

      schedulesDb.markScheduleRunViewed(db, failed.id)
      schedulesDb.markScheduleRunViewed(db, running.id)

      expect(schedulesDb.countUnreadScheduleRuns(db)).toEqual({ total: 1, failed: 0 })
    })

    it('marks a single finished run viewed once', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)
      schedulesDb.updateScheduleRun(db, repoId, job.id, run.id, { status: 'completed', finishedAt: 2_000 })

      expect(schedulesDb.markScheduleRunViewed(db, run.id)).toBe(true)
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, run.id)?.viewedAt).toBeGreaterThan(0)
      expect(schedulesDb.markScheduleRunViewed(db, run.id)).toBe(false)
    })

    it('does not mark a running run viewed', () => {
      const job = seedScheduleJob(db, repoId)
      const run = startRun(db, job)

      expect(schedulesDb.markScheduleRunViewed(db, run.id)).toBe(false)
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, run.id)?.viewedAt).toBeNull()
    })

    it('marks every unviewed finished run viewed and returns the changed count', () => {
      const job = seedScheduleJob(db, repoId)
      const first = startRun(db, job, { startedAt: 1_000 })
      const second = startRun(db, job, { startedAt: 2_000 })
      const running = startRun(db, job, { startedAt: 3_000 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, first.id, { status: 'completed', finishedAt: 1_500 })
      schedulesDb.updateScheduleRun(db, repoId, job.id, second.id, { status: 'failed', finishedAt: 2_500 })

      expect(schedulesDb.markAllScheduleRunsViewed(db)).toBe(2)
      expect(schedulesDb.countUnreadScheduleRuns(db)).toEqual({ total: 0, failed: 0 })
      expect(schedulesDb.getScheduleRunById(db, repoId, job.id, running.id)?.viewedAt).toBeNull()
    })
  })

  describe('extractReportPreview', () => {
    it('returns null for empty input', () => {
      expect(schedulesDb.extractReportPreview(null)).toBeNull()
      expect(schedulesDb.extractReportPreview('')).toBeNull()
      expect(schedulesDb.extractReportPreview('   \n  \n')).toBeNull()
    })

    it('strips markdown markers and returns the first non-empty line', () => {
      expect(schedulesDb.extractReportPreview('## Heading\n\nBody text')).toBe('Heading')
      expect(schedulesDb.extractReportPreview('- item one\n- item two')).toBe('item one')
      expect(schedulesDb.extractReportPreview('1. first step')).toBe('first step')
      expect(schedulesDb.extractReportPreview('> quoted line')).toBe('quoted line')
      expect(schedulesDb.extractReportPreview('**bold** and `code`')).toBe('bold and code')
    })

    it('skips leading blank lines before the first content', () => {
      expect(schedulesDb.extractReportPreview('\n\n   \n### Real heading')).toBe('Real heading')
      expect(schedulesDb.extractReportPreview('I have enough evidence.\n\n# Drift Review\n\nBody')).toBe('Drift Review')
    })

    it('collapses whitespace', () => {
      expect(schedulesDb.extractReportPreview('  hello    world  ')).toBe('hello world')
    })

    it('caps long previews with a trailing ellipsis', () => {
      const preview = schedulesDb.extractReportPreview('x'.repeat(300))

      expect(preview).not.toBeNull()
      expect(preview?.endsWith('…')).toBe(true)
      expect(preview?.replace(/…$/, '')).toHaveLength(160)
    })
  })
})
