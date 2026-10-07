import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { MultiRun } from '@opencode-manager/shared/schemas'
import { createMultiRunRoutes } from '../../src/routes/multi-runs'
import { MultiRunError, type MultiRunService } from '../../src/services/multi-runs'

function createRun(overrides: Partial<MultiRun> = {}): MultiRun {
  return {
    id: 1,
    repoId: 1,
    name: 'Sweep',
    prompt: 'go',
    isolated: true,
    baseRef: null,
    createdAt: 1,
    entries: [],
    fusions: [],
    ...overrides,
  }
}

function launchBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    repoId: 1,
    name: 'Sweep',
    prompt: 'go',
    models: ['openai/a'],
    isolate: true,
    ...overrides,
  })
}

function fuseBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requestId: '11111111-1111-4111-8111-111111111111',
    entryIds: [1, 2],
    model: 'openai/a',
    ...overrides,
  })
}

describe('multi-run routes', () => {
  let service: {
    list: ReturnType<typeof vi.fn>
    launch: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    fuse: ReturnType<typeof vi.fn>
  }
  let app: Hono

  beforeEach(() => {
    service = { list: vi.fn(), launch: vi.fn(), discard: vi.fn(), fuse: vi.fn() }
    app = new Hono()
    app.route('/multi-runs', createMultiRunRoutes(service as unknown as MultiRunService))
  })

  it('GET returns the repository runs', async () => {
    service.list.mockReturnValue([createRun()])

    const res = await app.request('/multi-runs?repoId=1')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ runs: [createRun()] })
    expect(service.list).toHaveBeenCalledWith(1)
  })

  it('GET rejects a missing repoId with 400', async () => {
    const res = await app.request('/multi-runs')

    expect(res.status).toBe(400)
    expect(service.list).not.toHaveBeenCalled()
  })

  it('POST launches a run and returns 201', async () => {
    service.launch.mockResolvedValue(createRun())

    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody(),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ run: createRun() })
    expect(service.launch).toHaveBeenCalledWith({
      repoId: 1,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
  })

  it('POST rejects more than five models with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody({
        models: ['openai/a', 'openai/b', 'openai/c', 'openai/d', 'openai/e', 'openai/f'],
      }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: expect.any(String), details: expect.any(Array) })
    expect(service.launch).not.toHaveBeenCalled()
  })

  it('POST rejects duplicate models with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody({ models: ['openai/a', 'openai/a'] }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Models must be unique', details: expect.any(Array) })
    expect(service.launch).not.toHaveBeenCalled()
  })

  it('POST rejects malformed JSON with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON' })
    expect(service.launch).not.toHaveBeenCalled()
  })

  it('POST maps a service error to its status', async () => {
    service.launch.mockRejectedValue(new MultiRunError('Repository not found or not ready', 404))

    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody(),
    })

    expect(res.status).toBe(404)
  })

  it('POST discard calls the service with numeric ids', async () => {
    service.discard.mockResolvedValue(createRun())

    const res = await app.request('/multi-runs/3/entries/7/discard', { method: 'POST' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ run: createRun() })
    expect(service.discard).toHaveBeenCalledWith(3, 7)
  })

  it('POST discard maps a missing entry to 404', async () => {
    service.discard.mockRejectedValue(new MultiRunError('Multi-run entry not found', 404))

    const res = await app.request('/multi-runs/3/entries/7/discard', { method: 'POST' })

    expect(res.status).toBe(404)
  })

  it('POST fusions fuses a run and returns 201 when created', async () => {
    service.fuse.mockResolvedValue({ run: createRun(), created: true })

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ run: createRun() })
    expect(service.fuse).toHaveBeenCalledWith(3, {
      requestId: '11111111-1111-4111-8111-111111111111',
      entryIds: [1, 2],
      model: 'openai/a',
    })
  })

  it('POST fusions returns 200 for an idempotent replay', async () => {
    service.fuse.mockResolvedValue({ run: createRun(), created: false })

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ run: createRun() })
  })

  it('POST fusions serialises an unavailable-sources error with code and details', async () => {
    service.fuse.mockRejectedValue(
      new MultiRunError('Some selected results are not ready to fuse', 409, {
        code: 'FUSION_SOURCES_UNAVAILABLE',
        details: {
          unavailableSources: [
            { entryId: 2, model: 'openai/b', reason: 'running', message: 'The session is still running.' },
          ],
        },
      }),
    )

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'Some selected results are not ready to fuse',
      code: 'FUSION_SOURCES_UNAVAILABLE',
      details: {
        unavailableSources: [
          { entryId: 2, model: 'openai/b', reason: 'running', message: 'The session is still running.' },
        ],
      },
    })
  })

  it('POST fusions maps a missing run to 404', async () => {
    service.fuse.mockRejectedValue(new MultiRunError('Multi-run not found', 404))

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(404)
  })

  it('POST fusions rejects a body with fewer than two entries with 400', async () => {
    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody({ entryIds: [1] }),
    })

    expect(res.status).toBe(400)
    expect(service.fuse).not.toHaveBeenCalled()
  })
})
