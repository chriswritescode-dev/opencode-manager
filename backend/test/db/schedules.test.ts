import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schedulesDb from '../../src/db/schedules'

const mockDb = {
  prepare: vi.fn(),
} as any

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    repo_id: 42,
    name: 'Weekly engineering summary',
    description: 'Summarize repo health and recent changes.',
    enabled: 1,
    schedule_mode: 'cron',
    interval_minutes: null,
    cron_expression: '0 9 * * 1',
    timezone: 'UTC',
    agent_slug: 'planner',
    prompt: 'Generate a weekly summary.',
    model: 'openai/gpt-5-mini',
    skill_metadata: JSON.stringify({ skillSlugs: ['planning'], notes: 'Optional notes' }),
    created_at: Date.UTC(2026, 2, 8, 12, 0, 0),
    updated_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    last_run_at: Date.UTC(2026, 2, 9, 11, 0, 0),
    next_run_at: Date.UTC(2026, 2, 9, 13, 0, 0),
    ...overrides,
  }
}

function makeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    job_id: 7,
    repo_id: 42,
    trigger_source: 'manual',
    status: 'running',
    started_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    finished_at: null,
    created_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    session_id: 'ses-1',
    session_title: 'Scheduled: Weekly engineering summary',
    log_text: 'Run started. Waiting for assistant response...',
    response_text: null,
    error_text: null,
    ...overrides,
  }
}

describe('schedule database queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists schedule jobs and parses persisted metadata', () => {
    const stmt = {
      all: vi.fn().mockReturnValue([makeJobRow()]),
    }
    mockDb.prepare.mockReturnValue(stmt)

    const jobs = schedulesDb.listScheduleJobsByRepo(mockDb, 42)

    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM schedule_jobs WHERE repo_id = ? ORDER BY created_at DESC')
    expect(jobs[0]).toMatchObject({
      id: 7,
      repoId: 42,
      scheduleMode: 'cron',
      skillMetadata: {
        skillSlugs: ['planning'],
        notes: 'Optional notes',
      },
    })
  })

  it('creates a schedule job and reloads the inserted row', () => {
    const insertStmt = {
      run: vi.fn().mockReturnValue({ lastInsertRowid: 7 }),
    }
    const selectStmt = {
      get: vi.fn().mockReturnValue(makeJobRow()),
    }

    mockDb.prepare.mockReturnValueOnce(insertStmt).mockReturnValueOnce(selectStmt)

    const job = schedulesDb.createScheduleJob(mockDb, 42, {
      name: 'Weekly engineering summary',
      description: 'Summarize repo health and recent changes.',
      enabled: true,
      scheduleMode: 'cron',
      intervalMinutes: null,
      cronExpression: '0 9 * * 1',
      timezone: 'UTC',
      agentSlug: 'planner',
      prompt: 'Generate a weekly summary.',
      model: 'openai/gpt-5-mini',
      skillMetadata: { skillSlugs: ['planning'], notes: 'Optional notes' },
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
    })

    expect(insertStmt.run).toHaveBeenCalledWith(
      42,
      'Weekly engineering summary',
      'Summarize repo health and recent changes.',
      1,
      'cron',
      null,
      '0 9 * * 1',
      'UTC',
      'planner',
      'Generate a weekly summary.',
      'openai/gpt-5-mini',
      JSON.stringify({ skillSlugs: ['planning'], notes: 'Optional notes' }),
      expect.any(Number),
      expect.any(Number),
      null,
      Date.UTC(2026, 2, 9, 13, 0, 0),
    )
    expect(job.id).toBe(7)
  })

  it('updates a schedule job when it exists', () => {
    const existingStmt = {
      get: vi.fn().mockReturnValue(makeJobRow({ name: 'Existing summary' })),
    }
    const updateStmt = {
      run: vi.fn(),
    }
    const reloadStmt = {
      get: vi.fn().mockReturnValue(makeJobRow({ name: 'Updated summary', enabled: 0, skill_metadata: null })),
    }

    mockDb.prepare
      .mockReturnValueOnce(existingStmt)
      .mockReturnValueOnce(updateStmt)
      .mockReturnValueOnce(reloadStmt)

    const job = schedulesDb.updateScheduleJob(mockDb, 42, 7, {
      name: 'Updated summary',
      description: null,
      enabled: false,
      scheduleMode: 'interval',
      intervalMinutes: 90,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Run a new summary.',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
    })

    expect(updateStmt.run).toHaveBeenCalledWith(
      'Updated summary',
      null,
      0,
      'interval',
      90,
      null,
      null,
      null,
      'Run a new summary.',
      null,
      null,
      expect.any(Number),
      null,
      42,
      7,
    )
    expect(job).toMatchObject({
      name: 'Updated summary',
      enabled: false,
      skillMetadata: null,
    })
  })

  it('returns null when updating metadata for a missing run', () => {
    const selectStmt = {
      get: vi.fn().mockReturnValue(undefined),
    }
    mockDb.prepare.mockReturnValue(selectStmt)

    const run = schedulesDb.updateScheduleRunMetadata(mockDb, 42, 7, 5, {
      sessionTitle: 'Updated title',
    })

    expect(run).toBeNull()
  })

  it('updates schedule run metadata while preserving omitted fields', () => {
    const existingRun = makeRunRow({ response_text: 'Existing response', error_text: 'Existing error' })
    const existingStmt = {
      get: vi.fn().mockReturnValue(existingRun),
    }
    const updateStmt = {
      run: vi.fn(),
    }
    const reloadStmt = {
      get: vi.fn().mockReturnValue(makeRunRow({ session_title: 'Updated title', response_text: 'Existing response', error_text: 'Existing error' })),
    }

    mockDb.prepare
      .mockReturnValueOnce(existingStmt)
      .mockReturnValueOnce(updateStmt)
      .mockReturnValueOnce(reloadStmt)

    const run = schedulesDb.updateScheduleRunMetadata(mockDb, 42, 7, 5, {
      sessionTitle: 'Updated title',
    })

    expect(updateStmt.run).toHaveBeenCalledWith(
      'ses-1',
      'Updated title',
      'Run started. Waiting for assistant response...',
      'Existing response',
      'Existing error',
      42,
      7,
      5,
    )
    expect(run?.sessionTitle).toBe('Updated title')
  })

  it('creates and reloads a schedule run', () => {
    const insertStmt = {
      run: vi.fn().mockReturnValue({ lastInsertRowid: 5 }),
    }
    const selectStmt = {
      get: vi.fn().mockReturnValue(makeRunRow()),
    }

    mockDb.prepare.mockReturnValueOnce(insertStmt).mockReturnValueOnce(selectStmt)

    const run = schedulesDb.createScheduleRun(mockDb, {
      jobId: 7,
      repoId: 42,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    })

    expect(insertStmt.run).toHaveBeenCalledWith(7, 42, 'manual', 'running', expect.any(Number), expect.any(Number))
    expect(run.id).toBe(5)
  })

  it('lists active runs and maps persisted fields', () => {
    const stmt = {
      all: vi.fn().mockReturnValue([
        makeRunRow({ id: 5 }),
        makeRunRow({ id: 6, status: 'failed', error_text: 'Model unavailable' }),
      ]),
    }
    mockDb.prepare.mockReturnValue(stmt)

    const runs = schedulesDb.listRunningScheduleRuns(mockDb, 10)

    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE status = \'running\''))
    expect(runs).toHaveLength(2)
    expect(runs[1]).toMatchObject({ id: 6, status: 'failed', errorText: 'Model unavailable' })
  })

  it('lists run summaries without loading large log or response blobs', () => {
    const stmt = {
      all: vi.fn().mockReturnValue([
        makeRunRow({ log_text: null, response_text: null, error_text: 'Run failed' }),
      ]),
    }
    mockDb.prepare.mockReturnValue(stmt)

    const runs = schedulesDb.listScheduleRunsByJob(mockDb, 42, 7, 5)

    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('NULL AS log_text'))
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('NULL AS response_text'))
    expect(runs[0]).toMatchObject({
      id: 5,
      logText: null,
      responseText: null,
      errorText: 'Run failed',
    })
  })

  it('returns the running run for a job when present', () => {
    const stmt = {
      get: vi.fn().mockReturnValue(makeRunRow({ id: 8 })),
    }
    mockDb.prepare.mockReturnValue(stmt)

    const run = schedulesDb.getRunningScheduleRunByJob(mockDb, 42, 7)

    expect(run).toMatchObject({ id: 8, sessionId: 'ses-1' })
  })
})
