import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  MultiRunSchema,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MultiRun,
} from '@opencode-manager/shared/schemas'
import { createMultiRunRoutes, type MultiRunRoutesService } from '../../src/routes/multi-runs'
import { MultiRunError } from '../../src/services/multi-runs'
import { readJson } from '../helpers/read-json'

const RunResponseSchema = z.object({ run: MultiRunSchema })
const RunsResponseSchema = z.object({ runs: z.array(MultiRunSchema) })
const InvalidRequestSchema = z.object({
  error: z.string(),
  details: z.array(z.object({ message: z.string() })),
})
const ErrorResponseSchema = z.object({ error: z.string(), code: z.string().optional() })
const FusionUnavailableErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.object({
    unavailableSources: z.array(z.object({
      entryId: z.number(),
      model: z.string(),
      reason: z.string(),
      message: z.string(),
    })),
  }),
})

function createRun(overrides: Partial<MultiRun> = {}): MultiRun {
  return {
    id: 1,
    repoId: 1,
    serverId: 'local',
    directory: null,
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

function createMultiRunRoutesService(
  overrides: Partial<MultiRunRoutesService> = {},
): MultiRunRoutesService {
  return {
    discard: vi.fn<MultiRunRoutesService['discard']>(),
    fuse: vi.fn<MultiRunRoutesService['fuse']>(),
    launch: vi.fn<MultiRunRoutesService['launch']>(),
    list: vi.fn<MultiRunRoutesService['list']>(),
    ...overrides,
  }
}

function launchBody(overrides: Partial<LaunchMultiRunRequest> = {}): string {
  return JSON.stringify({
    repoId: 1,
    name: 'Sweep',
    prompt: 'go',
    models: ['openai/a'],
    isolate: true,
    ...overrides,
  })
}

function fuseBody(overrides: Partial<FuseMultiRunRequest> = {}): string {
  return JSON.stringify({
    requestId: '11111111-1111-4111-8111-111111111111',
    entryIds: [1, 2],
    model: 'openai/a',
    ...overrides,
  })
}

describe('multi-run routes', () => {
  let service: MultiRunRoutesService
  let list: ReturnType<typeof vi.fn<MultiRunRoutesService['list']>>
  let launch: ReturnType<typeof vi.fn<MultiRunRoutesService['launch']>>
  let discard: ReturnType<typeof vi.fn<MultiRunRoutesService['discard']>>
  let fuse: ReturnType<typeof vi.fn<MultiRunRoutesService['fuse']>>
  let app: Hono

  beforeEach(() => {
    list = vi.fn<MultiRunRoutesService['list']>()
    launch = vi.fn<MultiRunRoutesService['launch']>()
    discard = vi.fn<MultiRunRoutesService['discard']>()
    fuse = vi.fn<MultiRunRoutesService['fuse']>()
    service = createMultiRunRoutesService({ list, launch, discard, fuse })
    app = new Hono()
    app.route('/multi-runs', createMultiRunRoutes(service))
  })

  it('GET returns the repository runs', async () => {
    list.mockReturnValue([createRun()])

    const res = await app.request('/multi-runs?repoId=1')

    expect(res.status).toBe(200)
    expect(await readJson(res, RunsResponseSchema)).toEqual({ runs: [createRun()] })
    expect(list).toHaveBeenCalledWith({ kind: 'repo', repoId: 1 })
  })

  it('GET returns the runs of a server directory', async () => {
    list.mockReturnValue([])

    const res = await app.request('/multi-runs?serverId=srv_kitchen&directory=%2Fsrv%2Fapp')

    expect(res.status).toBe(200)
    expect(list).toHaveBeenCalledWith({
      kind: 'server',
      serverId: 'srv_kitchen',
      directory: '/srv/app',
    })
  })

  it.each([
    ['a server target without a directory', '/multi-runs?serverId=srv_kitchen'],
    ['a missing repoId', '/multi-runs'],
  ])('GET rejects %s with 400', async (_label, url) => {
    const res = await app.request(url)

    expect(res.status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  it('POST launches a run and returns 201', async () => {
    launch.mockResolvedValue(createRun())

    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody(),
    })

    expect(res.status).toBe(201)
    expect(await readJson(res, RunResponseSchema)).toEqual({ run: createRun() })
    expect(launch).toHaveBeenCalledWith({
      repoId: 1,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
  })

  it('POST launches a run for a server directory', async () => {
    launch.mockResolvedValue(createRun({ repoId: null, serverId: 'srv_kitchen', directory: '/srv/app' }))

    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: 'srv_kitchen',
        directory: '/srv/app',
        name: 'Sweep',
        prompt: 'go',
        models: ['openai/a'],
        isolate: true,
      }),
    })

    expect(res.status).toBe(201)
    expect(launch).toHaveBeenCalledWith({
      serverId: 'srv_kitchen',
      directory: '/srv/app',
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
  })

  it.each([
    ['both a repository and a server target', launchBody({ serverId: 'srv_kitchen', directory: '/srv/app' })],
    [
      'a server target without a directory',
      JSON.stringify({ serverId: 'srv_kitchen', name: 'Sweep', prompt: 'go', models: ['openai/a'], isolate: true }),
    ],
    ['more than five models', launchBody({ models: ['openai/a', 'openai/b', 'openai/c', 'openai/d', 'openai/e', 'openai/f'] })],
  ])('POST rejects a launch with %s', async (_label, body) => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(400)
    expect((await readJson(res, InvalidRequestSchema)).details.length).toBeGreaterThan(0)
    expect(launch).not.toHaveBeenCalled()
  })

  it('POST rejects duplicate models with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody({ models: ['openai/a', 'openai/a'] }),
    })

    expect(res.status).toBe(400)
    const body = await readJson(res, InvalidRequestSchema)
    expect(body.error).toContain('Models must be unique')
    expect(launch).not.toHaveBeenCalled()
  })

  it('POST rejects malformed JSON with 400', async () => {
    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Invalid JSON' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('POST maps a service error to its status', async () => {
    launch.mockRejectedValue(new MultiRunError('Repository not found or not ready', 404))

    const res = await app.request('/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: launchBody(),
    })

    expect(res.status).toBe(404)
    expect(await readJson(res, ErrorResponseSchema)).toMatchObject({ error: 'Repository not found or not ready' })
  })

  it('POST discard calls the service with numeric ids', async () => {
    discard.mockResolvedValue(createRun())

    const res = await app.request('/multi-runs/3/entries/7/discard', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await readJson(res, RunResponseSchema)).toEqual({ run: createRun() })
    expect(discard).toHaveBeenCalledWith(3, 7)
  })

  it('POST discard maps a missing entry to 404', async () => {
    discard.mockRejectedValue(new MultiRunError('Multi-run entry not found', 404))

    const res = await app.request('/multi-runs/3/entries/7/discard', { method: 'POST' })

    expect(res.status).toBe(404)
  })

  it('POST fusions fuses a run and returns 201 when created', async () => {
    fuse.mockResolvedValue({ run: createRun(), created: true })

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(201)
    expect(await readJson(res, RunResponseSchema)).toEqual({ run: createRun() })
    expect(fuse).toHaveBeenCalledWith(3, {
      requestId: '11111111-1111-4111-8111-111111111111',
      entryIds: [1, 2],
      model: 'openai/a',
    })
  })

  it('POST fusions returns 200 for an idempotent replay', async () => {
    fuse.mockResolvedValue({ run: createRun(), created: false })

    const res = await app.request('/multi-runs/3/fusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fuseBody(),
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, RunResponseSchema)).toEqual({ run: createRun() })
  })

  it('POST fusions serialises an unavailable-sources error with code and details', async () => {
    fuse.mockRejectedValue(
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
    expect(await readJson(res, FusionUnavailableErrorSchema)).toEqual({
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
    fuse.mockRejectedValue(new MultiRunError('Multi-run not found', 404))

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
    expect(fuse).not.toHaveBeenCalled()
  })
})
