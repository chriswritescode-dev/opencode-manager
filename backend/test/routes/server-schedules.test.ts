import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { ScheduleServiceError } from '../../src/services/schedules'

const scheduleService = {
  listServerJobs: vi.fn(),
  createServerJob: vi.fn(),
  getServerJob: vi.fn(),
  updateServerJob: vi.fn(),
  deleteServerJob: vi.fn(),
  runServerJob: vi.fn(),
  listServerRuns: vi.fn(),
  getServerRun: vi.fn(),
  cancelServerRun: vi.fn(),
  clearServerRunHistory: vi.fn(),
  deleteServerRun: vi.fn(),
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

import { createServerScheduleRoutes } from '../../src/routes/schedules'

describe('Server schedule routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/opencode-servers/:serverId/schedules', createServerScheduleRoutes(scheduleService as unknown as import('../../src/services/schedules').ScheduleService))
  })

  it('lists jobs for a linked server', async () => {
    scheduleService.listServerJobs.mockReturnValue([{ id: 7 }])

    const response = await app.request('/opencode-servers/srv_kitchen/schedules')
    const body = await response.json() as { jobs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(scheduleService.listServerJobs).toHaveBeenCalledWith('srv_kitchen')
  })

  it('creates a remote schedule with its target directory', async () => {
    scheduleService.createServerJob.mockResolvedValue({ id: 7, serverId: 'srv_kitchen' })

    const response = await app.request('/opencode-servers/srv_kitchen/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nightly audit',
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Audit the project.',
        directory: '/srv/projects/audit',
      }),
    })

    expect(response.status).toBe(201)
    expect(scheduleService.createServerJob).toHaveBeenCalledWith(
      'srv_kitchen',
      '/srv/projects/audit',
      expect.objectContaining({ directory: '/srv/projects/audit' }),
    )
  })

  it('rejects a remote schedule without a directory', async () => {
    const response = await app.request('/opencode-servers/srv_kitchen/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nightly audit',
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Audit the project.',
      }),
    })

    expect(response.status).toBe(400)
    expect(scheduleService.createServerJob).not.toHaveBeenCalled()
  })

  it('updates, runs, and cancels a remote schedule', async () => {
    scheduleService.updateServerJob.mockResolvedValue({ id: 7 })
    scheduleService.runServerJob.mockResolvedValue({ id: 11, status: 'running' })
    scheduleService.cancelServerRun.mockResolvedValue({ id: 11, status: 'cancelled' })

    const updateResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated audit' }),
    })
    expect(updateResponse.status).toBe(200)
    expect(scheduleService.updateServerJob).toHaveBeenCalledWith('srv_kitchen', 7, { name: 'Updated audit' })

    const runResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/run', { method: 'POST' })
    expect(runResponse.status).toBe(200)
    expect(scheduleService.runServerJob).toHaveBeenCalledWith('srv_kitchen', 7, 'manual')

    const cancelResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11/cancel', { method: 'POST' })
    expect(cancelResponse.status).toBe(200)
    expect(scheduleService.cancelServerRun).toHaveBeenCalledWith('srv_kitchen', 7, 11)
  })

  it('lists and deletes runs for a remote schedule', async () => {
    scheduleService.listServerRuns.mockReturnValue([{ id: 11 }])
    scheduleService.getServerRun.mockReturnValue({ id: 11 })
    scheduleService.clearServerRunHistory.mockResolvedValue({ cleared: 1 })
    scheduleService.deleteServerRun.mockResolvedValue(undefined)

    const listResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs')
    expect(listResponse.status).toBe(200)
    expect(scheduleService.listServerRuns).toHaveBeenCalledWith('srv_kitchen', 7, 20)

    const getResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11')
    expect(getResponse.status).toBe(200)
    expect(scheduleService.getServerRun).toHaveBeenCalledWith('srv_kitchen', 7, 11)

    const clearResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs', { method: 'DELETE' })
    expect(clearResponse.status).toBe(200)
    expect(scheduleService.clearServerRunHistory).toHaveBeenCalledWith('srv_kitchen', 7)

    const deleteResponse = await app.request('/opencode-servers/srv_kitchen/schedules/7/runs/11', { method: 'DELETE' })
    expect(deleteResponse.status).toBe(200)
    expect(scheduleService.deleteServerRun).toHaveBeenCalledWith('srv_kitchen', 7, 11)
  })

  it('maps service errors to their status', async () => {
    scheduleService.runServerJob.mockRejectedValue(new ScheduleServiceError('OpenCode server "Kitchen" is disabled', 400))

    const response = await app.request('/opencode-servers/srv_kitchen/schedules/7/run', { method: 'POST' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'OpenCode server "Kitchen" is disabled' })
  })
})
