import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { ManagerUpgradeError } from '../../src/services/manager-upgrade'
import type { ManagerUpgradeJob } from '../../src/db/manager-upgrade'

const fakeJob: ManagerUpgradeJob = {
  id: 1,
  status: 'pending',
  fromVersion: null,
  toVersion: 'latest',
  targetImage: 'ghcr.io/opencode-manager/manager:latest',
  error: null,
  startedAt: 1000,
  finishedAt: null,
}

const service = {
  getStatus: vi.fn(),
  startUpgrade: vi.fn(),
  reconcile: vi.fn(),
}

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createManagerUpgradeRoutes } from '../../src/routes/manager-upgrade'

describe('Manager Upgrade Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = createManagerUpgradeRoutes(service as unknown as import('../../src/services/manager-upgrade').ManagerUpgradeService)
  })

  it('GET /status returns status from service', async () => {
    service.getStatus.mockResolvedValue({
      supported: true,
      inDocker: true,
      socketAvailable: true,
      enabled: true,
      currentVersion: '1.0.0',
      job: fakeJob,
    })

    const response = await app.request('/status')
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.supported).toBe(true)
    expect(body.currentVersion).toBe('1.0.0')
    expect(body.job).toEqual(fakeJob)
  })

  it('POST / returns 202 with job when upgrade starts', async () => {
    service.startUpgrade.mockResolvedValue(fakeJob)

    const response = await app.request('/', { method: 'POST' })
    const body = await response.json() as { job: ManagerUpgradeJob }

    expect(response.status).toBe(202)
    expect(body.job).toEqual(fakeJob)
  })

  it('POST / passes version to service when provided', async () => {
    service.startUpgrade.mockResolvedValue(fakeJob)

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.0.0' }),
    })

    expect(response.status).toBe(202)
    expect(service.startUpgrade).toHaveBeenCalledWith('2.0.0')
  })

  it('POST / returns 409 when upgrade is already in progress', async () => {
    service.startUpgrade.mockRejectedValue(new ManagerUpgradeError('An upgrade is already in progress', 409))

    const response = await app.request('/', { method: 'POST' })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toBe('An upgrade is already in progress')
  })

  it('POST / tolerates empty JSON body', async () => {
    service.startUpgrade.mockResolvedValue(fakeJob)

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(202)
    expect(service.startUpgrade).toHaveBeenCalledWith(undefined)
  })

  it('POST / rejects malformed JSON without calling startUpgrade', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "version": "2.0.0"', // truncated/malformed JSON
    })

    expect(response.status).toBe(500)
    expect(service.startUpgrade).not.toHaveBeenCalled()
  })

  it('POST / returns 500 for unexpected service errors', async () => {
    service.startUpgrade.mockRejectedValue(new Error('Unexpected failure'))

    const response = await app.request('/', { method: 'POST' })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(500)
    expect(body.error).toBe('Unexpected failure')
  })
})
