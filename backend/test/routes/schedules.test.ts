import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { ScheduleJobSchema, ScheduleRunSchema, ScheduleRunStatusSchema } from '@opencode-manager/shared/schemas'
import { createScheduleRoutes } from '../../src/routes/schedules'
import { ScheduleServiceError } from '../../src/services/schedules'
import { readJson } from '../helpers/read-json'
import {
  buildScheduleJob,
  buildScheduleJobWithRepo,
  buildScheduleRun,
  buildScheduleRunWithContext,
  buildUnreadScheduleRun,
  createFakeScheduleService,
} from '../helpers/fake-schedule-service'

const RunSummarySchema = z.object({
  id: z.number(),
  status: ScheduleRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  viewedAt: z.number().nullable(),
  preview: z.string().nullable(),
})

const ScheduleJobWithRepoSchema = ScheduleJobSchema.extend({
  repoName: z.string(),
  repoPath: z.string(),
  repoUrl: z.string(),
  serverName: z.string().nullable(),
  lastRun: RunSummarySchema.nullable(),
  retainedWorktreeCount: z.number(),
})

const ScheduleRunWithContextSchema = ScheduleRunSchema.extend({
  jobName: z.string(),
  repoName: z.string(),
  repoPath: z.string(),
  serverName: z.string().nullable(),
})

const JobsEnvelopeSchema = z.object({ jobs: z.array(ScheduleJobSchema) })
const JobEnvelopeSchema = z.object({ job: ScheduleJobSchema })
const RunsEnvelopeSchema = z.object({ runs: z.array(ScheduleRunSchema) })
const RunEnvelopeSchema = z.object({ run: ScheduleRunSchema })
const AllJobsEnvelopeSchema = z.object({ jobs: z.array(ScheduleJobWithRepoSchema) })
const AllRunsEnvelopeSchema = z.object({ runs: z.array(ScheduleRunWithContextSchema) })
const UnreadRunsEnvelopeSchema = z.object({
  runs: z.array(ScheduleRunWithContextSchema.extend({ preview: z.string().nullable() })),
  total: z.number(),
  failed: z.number(),
})
const ErrorEnvelopeSchema = z.object({ error: z.string() })
const SuccessEnvelopeSchema = z.object({ success: z.boolean() })

const jsonHeaders = { 'Content-Type': 'application/json' }

function createApp(service = createFakeScheduleService()): Hono {
  const app = new Hono()
  app.route('/repos/:id/schedules', createScheduleRoutes(service))
  return app
}

describe('schedule routes', () => {
  it('lists the jobs of a repo', async () => {
    const app = createApp(createFakeScheduleService({ listJobs: vi.fn(() => [buildScheduleJob({ id: 7, name: 'Weekly engineering summary' })]) }))

    const response = await app.request('/repos/42/schedules')
    const body = await readJson(response, JobsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.jobs.map((job) => job.name)).toEqual(['Weekly engineering summary'])
  })

  it.each([
    {
      label: 'interval',
      request: { name: 'Daily release summary', scheduleMode: 'interval', intervalMinutes: 60, prompt: 'Summarize release readiness.' },
      expected: { scheduleMode: 'interval', intervalMinutes: 60, cronExpression: null },
    },
    {
      label: 'cron',
      request: {
        name: 'Morning report',
        scheduleMode: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        prompt: 'Generate the daily report.',
      },
      expected: { scheduleMode: 'cron', cronExpression: '0 9 * * *', timezone: 'America/New_York' },
    },
  ])('creates a $label schedule from a validated request body', async ({ request, expected }) => {
    let receivedRepoId = 0
    const app = createApp(createFakeScheduleService({
      createJob: vi.fn(async (repoId, input) => {
        receivedRepoId = repoId
        return buildScheduleJob({
          name: input.name,
          scheduleMode: input.scheduleMode,
          intervalMinutes: input.intervalMinutes ?? null,
          cronExpression: input.cronExpression ?? null,
          timezone: input.timezone ?? null,
        })
      }),
    }))

    const response = await app.request('/repos/42/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(request),
    })
    const body = await readJson(response, JobEnvelopeSchema)

    expect(response.status).toBe(201)
    expect(receivedRepoId).toBe(42)
    expect(body.job).toMatchObject({ name: request.name, ...expected })
  })

  it('runs a schedule manually', async () => {
    const app = createApp(createFakeScheduleService({
      runJob: vi.fn(async (_repoId, _jobId, triggerSource) => buildScheduleRun({
        status: 'running',
        finishedAt: null,
        triggerSource,
      })),
    }))

    const response = await app.request('/repos/42/schedules/7/run', { method: 'POST' })
    const body = await readJson(response, RunEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.run).toMatchObject({ status: 'running', triggerSource: 'manual' })
  })

  it('cancels a running schedule run', async () => {
    const app = createApp(createFakeScheduleService({
      cancelRun: vi.fn(async () => buildScheduleRun({ id: 5, status: 'cancelled' })),
    }))

    const response = await app.request('/repos/42/schedules/7/runs/5/cancel', { method: 'POST' })
    const body = await readJson(response, RunEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.run).toMatchObject({ id: 5, status: 'cancelled' })
  })

  it('maps service conflicts to HTTP 409 responses', async () => {
    const app = createApp(createFakeScheduleService({
      runJob: vi.fn(async () => {
        throw new ScheduleServiceError('Schedule is already running', 409)
      }),
    }))

    const response = await app.request('/repos/42/schedules/7/run', { method: 'POST' })
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(409)
    expect(body.error).toBe('Schedule is already running')
  })

  it('returns 400 for an invalid repo id', async () => {
    const app = createApp()

    const response = await app.request('/repos/not-a-number/schedules')
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid repo id')
  })

  it('returns 404 when the schedule job is not found', async () => {
    const app = createApp(createFakeScheduleService({ getJob: vi.fn(() => null) }))

    const response = await app.request('/repos/42/schedules/7')
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(404)
    expect(body.error).toBe('Schedule not found')
  })

  it('loads and updates a single schedule job', async () => {
    const app = createApp(createFakeScheduleService({
      getJob: vi.fn(() => buildScheduleJob({ name: 'Weekly engineering summary' })),
      updateJob: vi.fn(async (_repoId, _jobId, input) => buildScheduleJob({ name: input.name ?? 'Weekly engineering summary' })),
    }))

    const getResponse = await app.request('/repos/42/schedules/7')
    const getBody = await readJson(getResponse, JobEnvelopeSchema)

    const patchResponse = await app.request('/repos/42/schedules/7', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Updated engineering summary' }),
    })
    const patchBody = await readJson(patchResponse, JobEnvelopeSchema)

    expect(getResponse.status).toBe(200)
    expect(getBody.job.name).toBe('Weekly engineering summary')
    expect(patchResponse.status).toBe(200)
    expect(patchBody.job.name).toBe('Updated engineering summary')
  })

  it('lists runs and a single run, then deletes the schedule', async () => {
    const app = createApp(createFakeScheduleService({
      listRuns: vi.fn((_repoId, _jobId, limit) => [buildScheduleRun({ id: limit })],),
      getRun: vi.fn(() => buildScheduleRun({ id: 5 })),
    }))

    const runsResponse = await app.request('/repos/42/schedules/7/runs?limit=5')
    const runsBody = await readJson(runsResponse, RunsEnvelopeSchema)

    const runResponse = await app.request('/repos/42/schedules/7/runs/5')
    const runBody = await readJson(runResponse, RunEnvelopeSchema)

    const deleteResponse = await app.request('/repos/42/schedules/7', { method: 'DELETE' })
    const deleteBody = await readJson(deleteResponse, SuccessEnvelopeSchema)

    expect(runsResponse.status).toBe(200)
    expect(runsBody.runs.map((run) => run.id)).toEqual([5])
    expect(runResponse.status).toBe(200)
    expect(runBody.run.id).toBe(5)
    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
  })

  it('rejects non-positive run list limits', async () => {
    const app = createApp()

    const response = await app.request('/repos/42/schedules/7/runs?limit=0')
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Limit must be greater than 0')
  })

  it('clamps large run list limits', async () => {
    const app = createApp(createFakeScheduleService({
      listRuns: vi.fn((_repoId, _jobId, limit) => [buildScheduleRun({ id: limit })]),
    }))

    const response = await app.request('/repos/42/schedules/7/runs?limit=500')
    const body = await readJson(response, RunsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.runs.map((run) => run.id)).toEqual([100])
  })

  it('lists all schedules across all repos', async () => {
    const app = createApp(createFakeScheduleService({
      listAllJobsWithRepos: vi.fn(() => [
        buildScheduleJobWithRepo({ id: 1, name: 'Job 1', repoName: 'Repo A' }),
        buildScheduleJobWithRepo({ id: 2, name: 'Job 2', repoName: 'Repo B' }),
      ]),
    }))

    const response = await app.request('/repos/42/schedules/all')
    const body = await readJson(response, AllJobsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.jobs.map((job) => [job.name, job.repoName])).toEqual([['Job 1', 'Repo A'], ['Job 2', 'Repo B']])
  })

  it('uses the default run list paging for all runs', async () => {
    let receivedLimit = 0
    let receivedOffset = -1
    const app = createApp(createFakeScheduleService({
      listAllRuns: vi.fn((options) => {
        receivedLimit = options.limit ?? 0
        receivedOffset = options.offset ?? -1
        return [buildScheduleRunWithContext({ id: 1 })]
      }),
    }))

    const response = await app.request('/repos/42/schedules/all/runs')
    const body = await readJson(response, AllRunsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.runs.map((run) => run.id)).toEqual([1])
    expect(receivedLimit).toBe(20)
    expect(receivedOffset).toBe(0)
  })

  it('passes every run filter query param to the service', async () => {
    let received = { limit: 0, offset: -1, status: '', repoId: -1, jobId: -1, triggerSource: '', runId: -1 }
    const app = createApp(createFakeScheduleService({
      listAllRuns: vi.fn((options) => {
        received = {
          limit: options.limit ?? 0,
          offset: options.offset ?? -1,
          status: options.status ?? '',
          repoId: options.repoId ?? -1,
          jobId: options.jobId ?? -1,
          triggerSource: options.triggerSource ?? '',
          runId: options.runId ?? -1,
        }
        return []
      }),
    }))

    const response = await app.request('/repos/42/schedules/all/runs?limit=10&offset=5&status=failed&repoId=42&jobId=7&triggerSource=manual&runId=99')

    expect(response.status).toBe(200)
    expect(received).toEqual({
      limit: 10,
      offset: 5,
      status: 'failed',
      repoId: 42,
      jobId: 7,
      triggerSource: 'manual',
      runId: 99,
    })
  })

  it.each(['abc', '1abc', '1.5', '-1', ''])('rejects an invalid runId format %s for all runs', async (runId) => {
    const app = createApp()

    const response = await app.request(`/repos/42/schedules/all/runs?runId=${encodeURIComponent(runId)}`)
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid run id')
  })

  it.each(['0', '99999999999999999999'])('rejects a non-positive or unsafe runId %s for all runs', async (runId) => {
    const app = createApp()

    const response = await app.request(`/repos/42/schedules/all/runs?runId=${runId}`)
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Run id must be a positive integer')
  })

  it('lists unread runs with counts using the default limit', async () => {
    let receivedLimit = 0
    const app = createApp(createFakeScheduleService({
      listUnreadRuns: vi.fn((limit) => {
        receivedLimit = limit
        return [buildUnreadScheduleRun({ id: 5, status: 'failed', preview: 'Deploy failed' })]
      }),
      countUnreadRuns: vi.fn(() => ({ total: 3, failed: 1 })),
    }))

    const response = await app.request('/repos/42/schedules/all/runs/unread')
    const body = await readJson(response, UnreadRunsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.runs.map((run) => run.preview)).toEqual(['Deploy failed'])
    expect(body.total).toBe(3)
    expect(body.failed).toBe(1)
    expect(receivedLimit).toBe(20)
  })

  it('clamps the unread runs limit', async () => {
    const app = createApp(createFakeScheduleService({
      listUnreadRuns: vi.fn((limit) => [buildUnreadScheduleRun({ id: limit })]),
      countUnreadRuns: vi.fn(() => ({ total: 0, failed: 0 })),
    }))

    const response = await app.request('/repos/42/schedules/all/runs/unread?limit=500')
    const body = await readJson(response, UnreadRunsEnvelopeSchema)

    expect(response.status).toBe(200)
    expect(body.runs.map((run) => run.id)).toEqual([100])
  })

  it('marks all finished runs viewed', async () => {
    const app = createApp(createFakeScheduleService({ markAllRunsViewed: vi.fn(() => 4) }))

    const response = await app.request('/repos/42/schedules/all/runs/viewed', { method: 'POST' })
    const body = await readJson(response, z.object({ updated: z.number() }))

    expect(response.status).toBe(200)
    expect(body.updated).toBe(4)
  })

  it('marks a single run viewed', async () => {
    const app = createApp(createFakeScheduleService({ markRunViewed: vi.fn(() => true) }))

    const response = await app.request('/repos/42/schedules/all/runs/5/viewed', { method: 'POST' })
    const body = await readJson(response, z.object({ updated: z.boolean() }))

    expect(response.status).toBe(200)
    expect(body.updated).toBe(true)
  })

  it('rejects an invalid run id when marking a run viewed', async () => {
    const app = createApp()

    const response = await app.request('/repos/42/schedules/all/runs/not-a-number/viewed', { method: 'POST' })
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid run id')
  })

  it.each([
    { query: '', expectedMode: 'commit' },
    { query: '?worktrees=discard', expectedMode: 'discard' },
  ])('clears run history with worktrees mode "$expectedMode"', async ({ query, expectedMode }) => {
    let receivedMode = ''
    const app = createApp(createFakeScheduleService({
      clearRunHistory: vi.fn(async (_repoId, _jobId, worktrees) => {
        receivedMode = worktrees
        return { cleared: 2 }
      }),
    }))

    const response = await app.request(`/repos/42/schedules/7/runs${query}`, { method: 'DELETE' })
    const body = await readJson(response, z.object({ cleared: z.number() }))

    expect(response.status).toBe(200)
    expect(body.cleared).toBe(2)
    expect(receivedMode).toBe(expectedMode)
  })

  it('rejects an invalid worktrees mode when clearing run history', async () => {
    const app = createApp()

    const response = await app.request('/repos/42/schedules/7/runs?worktrees=nope', { method: 'DELETE' })
    const body = await readJson(response, ErrorEnvelopeSchema)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid worktrees mode')
  })

  it('deletes a run with the requested worktrees mode', async () => {
    let receivedMode = ''
    const app = createApp(createFakeScheduleService({
      deleteRun: vi.fn(async (_repoId, _jobId, _runId, worktrees) => {
        receivedMode = worktrees
      }),
    }))

    const response = await app.request('/repos/42/schedules/7/runs/5?worktrees=discard', { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(receivedMode).toBe('discard')
  })
})
