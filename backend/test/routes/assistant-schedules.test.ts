import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'

const assistantRepo = {
  id: 99,
  repoUrl: undefined,
  localPath: 'assistant',
  fullPath: '/tmp/test-workspace/repos/assistant',
  branch: undefined,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 1,
  lastAccessedAt: 1,
  isLocal: true,
}

const scheduleService = {
  listJobs: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  runJob: vi.fn(),
  listRuns: vi.fn(),
}

vi.mock('../../src/services/assistant-mode', () => ({
  ensureAssistantRepo: vi.fn(() => assistantRepo),
  getAssistantSchedulerToken: vi.fn(() => Promise.resolve('test-token')),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createAssistantScheduleRoutes } from '../../src/routes/assistant-schedules'

describe('Assistant Schedule Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/assistant/schedules', createAssistantScheduleRoutes({} as Database, scheduleService as never))
  })

  it('rejects requests without the assistant scheduler token', async () => {
    const response = await app.request('/assistant/schedules')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(scheduleService.listJobs).not.toHaveBeenCalled()
  })

  it('lists schedules for the assistant repo only', async () => {
    scheduleService.listJobs.mockReturnValue([{ id: 7, name: 'Reminder' }])

    const response = await app.request('/assistant/schedules', {
      headers: { Authorization: 'Bearer test-token' },
    })
    const body = await response.json() as { jobs: Array<{ id: number }>; repo: { id: number } }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(body.repo.id).toBe(assistantRepo.id)
    expect(scheduleService.listJobs).toHaveBeenCalledWith(assistantRepo.id)
  })

  it('creates schedules for the assistant repo only', async () => {
    scheduleService.createJob.mockReturnValue({ id: 8, name: 'Hourly reminder' })

    const response = await app.request('/assistant/schedules', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Hourly reminder',
        enabled: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Remind me to check the release queue.',
      }),
    })

    expect(response.status).toBe(201)
    expect(scheduleService.createJob).toHaveBeenCalledWith(assistantRepo.id, expect.objectContaining({ name: 'Hourly reminder' }))
  })

  it('updates and deletes schedules for the assistant repo only', async () => {
    scheduleService.updateJob.mockReturnValue({ id: 8, name: 'Updated reminder' })
    scheduleService.deleteJob.mockReturnValue(undefined)

    const updateResponse = await app.request('/assistant/schedules/8', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated reminder' }),
    })

    const deleteResponse = await app.request('/assistant/schedules/8', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(updateResponse.status).toBe(200)
    expect(deleteResponse.status).toBe(200)
    expect(scheduleService.updateJob).toHaveBeenCalledWith(assistantRepo.id, 8, expect.objectContaining({ name: 'Updated reminder' }))
    expect(scheduleService.deleteJob).toHaveBeenCalledWith(assistantRepo.id, 8)
  })
})
