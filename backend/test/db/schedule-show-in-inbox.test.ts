import { describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { CreateScheduleJobRequestSchema, type ScheduleJob, type ScheduleRun, type ScheduleRunStatus, type ScheduleRunTriggerSource } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import {
  countUnreadScheduleRuns,
  createScheduleJob,
  createScheduleRun,
  getScheduleJobById,
  getScheduleRunById,
  listAllScheduleJobsWithRepos,
  listAllScheduleRuns,
  listScheduleRunsByJob,
  isQuietScheduleRunSession,
  listUnreadScheduleRuns,
  updateScheduleJob,
  updateScheduleRun,
  updateScheduleRunMetadata,
} from '../../src/db/schedules'
import {
  buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput,
} from '../../src/services/schedule-config'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createTestJob(db: Database, overrides: Record<string, unknown> = {}, serverId?: string): ScheduleJob {
  const repo = createRepo(db, {
    localPath: '/abs/repo',
    sourcePath: '/abs/repo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })
  const request = CreateScheduleJobRequestSchema.parse({
    name: 'Daily health check',
    scheduleMode: 'interval',
    intervalMinutes: 60,
    prompt: 'Review the repository and summarize risks.',
    ...overrides,
  })
  return createScheduleJob(db, repo.id, buildCreateSchedulePersistenceInput(request), serverId)
}

describe('schedule job show in inbox', () => {
  it('defaults a new job to showInInbox true', () => {
    const db = createTestDb()
    const created = createTestJob(db)

    const loaded = getScheduleJobById(db, created.repoId, created.id)

    expect(created.showInInbox).toBe(true)
    expect(loaded?.showInInbox).toBe(true)

    db.close()
  })

  it('persists showInInbox false and reads it back from both queries', () => {
    const db = createTestDb()
    const created = createTestJob(db, { showInInbox: false })

    const loaded = getScheduleJobById(db, created.repoId, created.id)
    const listed = listAllScheduleJobsWithRepos(db).find((job) => job.id === created.id)

    expect(created.showInInbox).toBe(false)
    expect(loaded?.showInInbox).toBe(false)
    expect(listed?.showInInbox).toBe(false)

    db.close()
  })

  it('preserves showInInbox false when an update omits it', () => {
    const db = createTestDb()
    const created = createTestJob(db, { showInInbox: false })

    const updated = updateScheduleJob(
      db,
      created.repoId,
      created.id,
      buildUpdatedSchedulePersistenceInput(created, { name: 'Renamed job' }),
    )

    expect(updated?.name).toBe('Renamed job')
    expect(updated?.showInInbox).toBe(false)

    db.close()
  })

  it('sets showInInbox back to true when an update provides it', () => {
    const db = createTestDb()
    const created = createTestJob(db, { showInInbox: false })

    const updated = updateScheduleJob(
      db,
      created.repoId,
      created.id,
      buildUpdatedSchedulePersistenceInput(created, { showInInbox: true }),
    )

    expect(updated?.showInInbox).toBe(true)

    db.close()
  })
})

function startRun(
  db: Database,
  job: ScheduleJob,
  triggerSource: ScheduleRunTriggerSource = 'schedule',
  serverId?: string,
): ScheduleRun {
  const startedAt = Date.now()
  return createScheduleRun(db, {
    jobId: job.id,
    repoId: job.repoId,
    serverId,
    triggerSource,
    status: 'running',
    startedAt,
    createdAt: startedAt,
  })
}

function finishRun(
  db: Database,
  job: ScheduleJob,
  runId: number,
  status: ScheduleRunStatus,
  finishedAt: number,
): ScheduleRun | null {
  return updateScheduleRun(db, job.repoId, job.id, runId, { status, finishedAt })
}

describe('finishing runs', () => {
  it('stores a completed quiet run as viewed while keeping it in history', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false })
    const run = startRun(db, job)
    const finishedAt = run.startedAt + 5_000

    finishRun(db, job, run.id, 'completed', finishedAt)

    const loaded = getScheduleRunById(db, job.repoId, job.id, run.id)
    expect(loaded?.viewedAt).toBe(finishedAt)
    expect(listUnreadScheduleRuns(db)).toHaveLength(0)
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 0, failed: 0 })
    expect(listScheduleRunsByJob(db, job.repoId, job.id).map((entry) => entry.id)).toContain(run.id)
    expect(listAllScheduleRuns(db, { jobId: job.id }).map((entry) => entry.id)).toContain(run.id)

    db.close()
  })

  it('leaves a failed quiet run unread', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false })
    const run = startRun(db, job)

    finishRun(db, job, run.id, 'failed', run.startedAt + 5_000)

    const loaded = getScheduleRunById(db, job.repoId, job.id, run.id)
    expect(loaded?.viewedAt).toBeNull()
    expect(listUnreadScheduleRuns(db).map((entry) => entry.id)).toEqual([run.id])
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 1, failed: 1 })

    db.close()
  })

  it('stores a completed manual run of a quiet job as viewed', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false })
    const run = startRun(db, job, 'manual')
    const finishedAt = run.startedAt + 5_000

    finishRun(db, job, run.id, 'completed', finishedAt)

    expect(getScheduleRunById(db, job.repoId, job.id, run.id)?.viewedAt).toBe(finishedAt)
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 0, failed: 0 })

    db.close()
  })

  it('keeps a completed announcing run unread', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: true })
    const run = startRun(db, job)

    finishRun(db, job, run.id, 'completed', run.startedAt + 5_000)

    expect(getScheduleRunById(db, job.repoId, job.id, run.id)?.viewedAt).toBeNull()
    expect(listUnreadScheduleRuns(db).map((entry) => entry.id)).toEqual([run.id])
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 1, failed: 0 })

    db.close()
  })

  it('does not rewrite runs that finished before the job became quiet', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: true })
    const run = startRun(db, job)

    finishRun(db, job, run.id, 'completed', run.startedAt + 5_000)
    updateScheduleJob(db, job.repoId, job.id, buildUpdatedSchedulePersistenceInput(job, { showInInbox: false }))

    expect(getScheduleRunById(db, job.repoId, job.id, run.id)?.viewedAt).toBeNull()
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 1, failed: 0 })

    db.close()
  })

  it('stores a run as viewed when the job became quiet while it was running', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: true })
    const run = startRun(db, job)

    updateScheduleJob(db, job.repoId, job.id, buildUpdatedSchedulePersistenceInput(job, { showInInbox: false }))
    const finishedAt = run.startedAt + 5_000
    finishRun(db, job, run.id, 'completed', finishedAt)

    expect(getScheduleRunById(db, job.repoId, job.id, run.id)?.viewedAt).toBe(finishedAt)
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 0, failed: 0 })

    db.close()
  })

  it('leaves a cancelled quiet run unread', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false })
    const run = startRun(db, job)

    finishRun(db, job, run.id, 'cancelled', run.startedAt + 5_000)

    expect(getScheduleRunById(db, job.repoId, job.id, run.id)?.viewedAt).toBeNull()
    expect(countUnreadScheduleRuns(db)).toEqual({ total: 0, failed: 0 })

    db.close()
  })
})

describe('quiet schedule run sessions', () => {
  it('reports the session of a quiet job as quiet', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false })
    const run = startRun(db, job)
    updateScheduleRunMetadata(db, job.repoId, job.id, run.id, { sessionId: 'ses_quiet' })

    expect(isQuietScheduleRunSession(db, 'ses_quiet')).toBe(true)

    db.close()
  })

  it('does not report the session of an announcing job as quiet', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: true })
    const run = startRun(db, job)
    updateScheduleRunMetadata(db, job.repoId, job.id, run.id, { sessionId: 'ses_loud' })

    expect(isQuietScheduleRunSession(db, 'ses_loud')).toBe(false)

    db.close()
  })

  it('does not report an unknown session as quiet', () => {
    const db = createTestDb()

    expect(isQuietScheduleRunSession(db, 'ses_unknown')).toBe(false)

    db.close()
  })

  it('scopes the lookup to the run server', () => {
    const db = createTestDb()
    const job = createTestJob(db, { showInInbox: false }, 'srv_kitchen')
    const run = startRun(db, job, 'schedule', 'srv_kitchen')
    updateScheduleRunMetadata(db, job.repoId, job.id, run.id, { sessionId: 'ses_remote' })

    expect(isQuietScheduleRunSession(db, 'ses_remote', 'srv_kitchen')).toBe(true)
    expect(isQuietScheduleRunSession(db, 'ses_remote')).toBe(false)

    db.close()
  })
})
