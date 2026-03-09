import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const mocks = vi.hoisted(() => {
  class MockScheduleServiceError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }

  return {
    MockScheduleServiceError,
    scheduleService: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      runJob: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      cancelRun: vi.fn(),
    },
  }
})

vi.mock('../../src/services/schedules', () => ({
  ScheduleService: vi.fn().mockImplementation(() => mocks.scheduleService),
  ScheduleServiceError: mocks.MockScheduleServiceError,
}))

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
    app.route('/repos/:id/schedules', createScheduleRoutes({} as never))
  })

  it('lists jobs for a repo', async () => {
    mocks.scheduleService.listJobs.mockReturnValue([{ id: 7, name: 'Weekly engineering summary' }])

    const response = await app.request('/repos/42/schedules')
    const body = await response.json() as { jobs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(mocks.scheduleService.listJobs).toHaveBeenCalledWith(42)
  })

  it('creates a schedule from a valid request body', async () => {
    mocks.scheduleService.createJob.mockReturnValue({ id: 7, name: 'Daily release summary' })

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
    expect(mocks.scheduleService.createJob).toHaveBeenCalledWith(42, expect.objectContaining({ name: 'Daily release summary' }))
  })

  it('runs a schedule manually', async () => {
    mocks.scheduleService.runJob.mockResolvedValue({ id: 5, status: 'running' })

    const response = await app.request('/repos/42/schedules/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { run: { id: number; status: string } }

    expect(response.status).toBe(200)
    expect(body.run).toEqual({ id: 5, status: 'running' })
    expect(mocks.scheduleService.runJob).toHaveBeenCalledWith(42, 7, 'manual')
  })

  it('cancels a running schedule run', async () => {
    mocks.scheduleService.cancelRun.mockResolvedValue({ id: 5, status: 'cancelled' })

    const response = await app.request('/repos/42/schedules/7/runs/5/cancel', {
      method: 'POST',
    })
    const body = await response.json() as { run: { status: string } }

    expect(response.status).toBe(200)
    expect(body.run.status).toBe('cancelled')
    expect(mocks.scheduleService.cancelRun).toHaveBeenCalledWith(42, 7, 5)
  })

  it('maps service conflicts to HTTP 409 responses', async () => {
    mocks.scheduleService.runJob.mockRejectedValue(new mocks.MockScheduleServiceError('Schedule is already running', 409))

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
    expect(mocks.scheduleService.listJobs).not.toHaveBeenCalled()
  })

  it('loads and updates a single schedule job', async () => {
    mocks.scheduleService.getJob.mockReturnValue({ id: 7, name: 'Weekly engineering summary' })
    mocks.scheduleService.updateJob.mockReturnValue({ id: 7, name: 'Updated engineering summary' })

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
    mocks.scheduleService.listRuns.mockReturnValue([{ id: 5, status: 'completed' }])
    mocks.scheduleService.getRun.mockReturnValue({ id: 5, status: 'completed' })
    mocks.scheduleService.deleteJob.mockReturnValue(undefined)

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
    expect(mocks.scheduleService.deleteJob).toHaveBeenCalledWith(42, 7)
  })
})
