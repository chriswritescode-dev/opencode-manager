import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { ScheduleServiceError } from '../../src/services/schedules'

const scheduleService = {
  listJobs: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  runJob: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  listAllEnabledJobs: vi.fn(),
  listAllJobsWithRepos: vi.fn(),
  listAllRuns: vi.fn(),
  recoverRunningRuns: vi.fn(),
  setJobChangeHandler: vi.fn(),
}

vi.mock('../../src/services/schedules', async () => {
  const actual = await vi.importActual('../../src/services/schedules')
  return {
    ...actual,
    ScheduleService: vi.fn().mockImplementation(() => scheduleService),
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createScheduleRoutes } from '../../src/routes/schedules'

describe('Schedule Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/repos/:id/schedules', createScheduleRoutes(scheduleService as unknown as import('../../src/services/schedules').ScheduleService))
  })

  it('lists jobs for a repo', async () => {
    scheduleService.listJobs.mockReturnValue([{ id: 7, name: 'Weekly engineering summary' }])

    const response = await app.request('/repos/42/schedules')
    const body = await response.json() as { jobs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(scheduleService.listJobs).toHaveBeenCalledWith(42)
  })

  it('creates a schedule from a valid request body', async () => {
    scheduleService.createJob.mockReturnValue({ id: 7, name: 'Daily release summary' })

    const response = await app.request('/repos/42/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Daily release summary',
        enabled: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Summarize release readiness.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(7)
    expect(scheduleService.createJob).toHaveBeenCalledWith(42, expect.objectContaining({ name: 'Daily release summary' }))
  })

  it('runs a schedule manually', async () => {
    scheduleService.runJob.mockResolvedValue({ id: 5, status: 'running' })

    const response = await app.request('/repos/42/schedules/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { run: { id: number; status: string } }

    expect(response.status).toBe(200)
    expect(body.run).toEqual({ id: 5, status: 'running' })
    expect(scheduleService.runJob).toHaveBeenCalledWith(42, 7, 'manual')
  })

  it('cancels a running schedule run', async () => {
    scheduleService.cancelRun.mockResolvedValue({ id: 5, status: 'cancelled' })

    const response = await app.request('/repos/42/schedules/7/runs/5/cancel', {
      method: 'POST',
    })
    const body = await response.json() as { run: { status: string } }

    expect(response.status).toBe(200)
    expect(body.run.status).toBe('cancelled')
    expect(scheduleService.cancelRun).toHaveBeenCalledWith(42, 7, 5)
  })

  it('maps service conflicts to HTTP 409 responses', async () => {
    scheduleService.runJob.mockRejectedValue(new ScheduleServiceError('Schedule is already running', 409))

    const response = await app.request('/repos/42/schedules/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toBe('Schedule is already running')
  })

  it('returns 400 for invalid route ids before reaching the service', async () => {
    const response = await app.request('/repos/not-a-number/schedules')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid repo id')
    expect(scheduleService.listJobs).not.toHaveBeenCalled()
  })

  it('loads and updates a single schedule job', async () => {
    scheduleService.getJob.mockReturnValue({ id: 7, name: 'Weekly engineering summary' })
    scheduleService.updateJob.mockReturnValue({ id: 7, name: 'Updated engineering summary' })

    const getResponse = await app.request('/repos/42/schedules/7')
    const getBody = await getResponse.json() as { job: { name: string } }

    const patchResponse = await app.request('/repos/42/schedules/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated engineering summary' }),
    })
    const patchBody = await patchResponse.json() as { job: { name: string } }

    expect(getResponse.status).toBe(200)
    expect(getBody.job.name).toBe('Weekly engineering summary')
    expect(patchResponse.status).toBe(200)
    expect(patchBody.job.name).toBe('Updated engineering summary')
  })

  it('lists runs, loads a single run, and deletes a schedule', async () => {
    scheduleService.listRuns.mockReturnValue([{ id: 5, status: 'completed' }])
    scheduleService.getRun.mockReturnValue({ id: 5, status: 'completed' })
    scheduleService.deleteJob.mockReturnValue(undefined)

    const runsResponse = await app.request('/repos/42/schedules/7/runs?limit=5')
    const runsBody = await runsResponse.json() as { runs: Array<{ id: number }> }

    const runResponse = await app.request('/repos/42/schedules/7/runs/5')
    const runBody = await runResponse.json() as { run: { id: number } }

    const deleteResponse = await app.request('/repos/42/schedules/7', {
      method: 'DELETE',
    })
    const deleteBody = await deleteResponse.json() as { success: boolean }

    expect(runsResponse.status).toBe(200)
    expect(runsBody.runs[0]?.id).toBe(5)
    expect(runResponse.status).toBe(200)
    expect(runBody.run.id).toBe(5)
    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(scheduleService.deleteJob).toHaveBeenCalledWith(42, 7)
  })

  it('rejects non-positive run list limits', async () => {
    const response = await app.request('/repos/42/schedules/7/runs?limit=0')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Limit must be greater than 0')
    expect(scheduleService.listRuns).not.toHaveBeenCalled()
  })

  it('clamps large run list limits', async () => {
    scheduleService.listRuns.mockReturnValue([])

    const response = await app.request('/repos/42/schedules/7/runs?limit=500')

    expect(response.status).toBe(200)
    expect(scheduleService.listRuns).toHaveBeenCalledWith(42, 7, 100)
  })

  it('returns 404 when schedule job is not found', async () => {
    scheduleService.getJob.mockReturnValue(null)

    const response = await app.request('/repos/42/schedules/7')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe('Schedule not found')
  })

  it('creates a cron schedule from a valid request body', async () => {
    scheduleService.createJob.mockReturnValue({ id: 8, name: 'Morning report' })

    const response = await app.request('/repos/42/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning report',
        enabled: true,
        scheduleMode: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        prompt: 'Generate the daily report.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(8)
    expect(scheduleService.createJob).toHaveBeenCalledWith(42, expect.objectContaining({
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
    }))
  })

  it('lists all schedules across all repos', async () => {
    scheduleService.listAllJobsWithRepos.mockReturnValue([
      { id: 1, name: 'Job 1', repoName: 'Repo A', repoPath: '/path/a', repoUrl: 'https://repo-a' },
      { id: 2, name: 'Job 2', repoName: 'Repo B', repoPath: '/path/b', repoUrl: 'https://repo-b' },
    ])

    const response = await app.request('/repos/42/schedules/all')
    const body = await response.json() as { jobs: Array<{ id: number; name: string; repoName: string }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs[0]).toEqual(expect.objectContaining({
      id: 1,
      name: 'Job 1',
      repoName: 'Repo A',
    }))
    expect(scheduleService.listAllJobsWithRepos).toHaveBeenCalled()
  })

  it('lists all runs with no filters', async () => {
    scheduleService.listAllRuns.mockReturnValue([
      { id: 1, jobId: 7, repoId: 42, status: 'completed', jobName: 'Test', repoName: 'repo', repoPath: '/repo' },
    ])

    const response = await app.request('/repos/42/schedules/all/runs')
    const body = await response.json() as { runs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(1)
    expect(scheduleService.listAllRuns).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }))
  })

  it('passes query params to service for all runs', async () => {
    scheduleService.listAllRuns.mockReturnValue([])

    const response = await app.request('/repos/42/schedules/all/runs?limit=10&offset=5&status=failed&repoId=42&jobId=7&triggerSource=manual')
    const body = await response.json() as { runs: Array<unknown> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(0)
    expect(scheduleService.listAllRuns).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      status: 'failed',
      repoId: 42,
      jobId: 7,
      triggerSource: 'manual',
    })
  })
})
