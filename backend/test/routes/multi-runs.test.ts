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

describe('multi-run routes', () => {
  let service: {
    list: ReturnType<typeof vi.fn>
    launch: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
  }
  let app: Hono

  beforeEach(() => {
    service = { list: vi.fn(), launch: vi.fn(), discard: vi.fn() }
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
    await expect(res.json()).resolves.toEqual({ error: 'Invalid request body', details: expect.any(Array) })
    expect(service.launch).not.toHaveBeenCalled()
  })

  it('POST rejects duplicate models with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody({ models: ['openai/a', 'openai/a'] }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid request body', details: expect.any(Array) })
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
})
