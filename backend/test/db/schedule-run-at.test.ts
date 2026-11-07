import { describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { CreateScheduleJobRequestSchema, type ScheduleJob } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import {
  createScheduleJob,
  disableScheduleJob,
  getScheduleJobById,
  updateScheduleJob,
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

function createTestRepo(db: Database): number {
  const repo = createRepo(db, {
    localPath: '/abs/repo',
    sourcePath: '/abs/repo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })
  return repo.id
}

function createOnceJob(db: Database, repoId: number, currentDate: number): ScheduleJob {
  const request = CreateScheduleJobRequestSchema.parse({
    name: 'One-time report',
    scheduleMode: 'once',
    runAt: '2026-11-20T09:00',
    timezone: 'Europe/Berlin',
    prompt: 'Generate the report.',
  })
  return createScheduleJob(db, repoId, buildCreateSchedulePersistenceInput(request, currentDate))
}

describe('schedule run at', () => {
  const currentDate = Date.UTC(2026, 10, 1, 12, 0, 0)

  it('accepts a valid once request and rejects a malformed date', () => {
    const request = {
      name: 'One-time request',
      scheduleMode: 'once' as const,
      timezone: 'Europe/Berlin',
      prompt: 'Generate the report.',
    }

    const parsed = CreateScheduleJobRequestSchema.parse({ ...request, runAt: '2026-11-20T09:00' })
    expect(parsed).toMatchObject({ scheduleMode: 'once', runAt: '2026-11-20T09:00' })
    expect(() => CreateScheduleJobRequestSchema.parse({ ...request, runAt: '2026-11-20 09:00' })).toThrow('Use YYYY-MM-DDTHH:mm')
  })

  it('round-trips a once schedule date, timezone and next run', () => {
    const db = createTestDb()
    const repoId = createTestRepo(db)

    const created = createOnceJob(db, repoId, currentDate)
    const loaded = getScheduleJobById(db, created.repoId, created.id)

    expect(created.scheduleMode).toBe('once')
    expect(created.runAt).toBe('2026-11-20T09:00')
    expect(created.timezone).toBe('Europe/Berlin')
    expect(created.nextRunAt).toBe(Date.UTC(2026, 10, 20, 8, 0, 0))
    expect(loaded?.runAt).toBe('2026-11-20T09:00')
    expect(loaded?.timezone).toBe('Europe/Berlin')
    expect(loaded?.nextRunAt).toBe(Date.UTC(2026, 10, 20, 8, 0, 0))

    const updated = updateScheduleJob(
      db,
      created.repoId,
      created.id,
      buildUpdatedSchedulePersistenceInput(created, { runAt: '2026-12-01T10:00' }, currentDate),
    )

    expect(updated?.runAt).toBe('2026-12-01T10:00')
    expect(getScheduleJobById(db, created.repoId, created.id)?.runAt).toBe('2026-12-01T10:00')

    db.close()
  })

  it('disables a schedule and clears its next run', () => {
    const db = createTestDb()
    const repoId = createTestRepo(db)
    const created = createOnceJob(db, repoId, currentDate)

    const disabled = disableScheduleJob(db, created.repoId, created.id)
    const loaded = getScheduleJobById(db, created.repoId, created.id)

    expect(disabled?.enabled).toBe(false)
    expect(disabled?.nextRunAt).toBeNull()
    expect(loaded?.enabled).toBe(false)
    expect(loaded?.nextRunAt).toBeNull()

    db.close()
  })

  it('reads a null run at for interval schedules', () => {
    const db = createTestDb()
    const repoId = createTestRepo(db)
    const request = CreateScheduleJobRequestSchema.parse({
      name: 'Interval report',
      scheduleMode: 'interval',
      intervalMinutes: 60,
      prompt: 'Generate the report.',
    })

    const created = createScheduleJob(db, repoId, buildCreateSchedulePersistenceInput(request, currentDate))

    expect(created.runAt).toBeNull()
    expect(getScheduleJobById(db, created.repoId, created.id)?.runAt).toBeNull()

    db.close()
  })
})
