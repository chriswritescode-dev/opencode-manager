import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { MultiRunSchema } from '@opencode-manager/shared/schemas'
import type { FuseMultiRunRequest, MultiRun } from '@opencode-manager/shared/schemas'
import type { MultiRunRoutesService } from '../../src/routes/multi-runs'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const MultiRunResponseSchema = z.object({ run: MultiRunSchema })
const MultiRunsResponseSchema = z.object({ runs: z.array(MultiRunSchema) })

interface MultiRunFakes {
  list: Mock<MultiRunRoutesService['list']>
  launch: Mock<MultiRunRoutesService['launch']>
  discard: Mock<MultiRunRoutesService['discard']>
  fuse: Mock<MultiRunRoutesService['fuse']>
}

function createMultiRunFakes(): MultiRunFakes {
  return {
    list: vi.fn<MultiRunRoutesService['list']>(),
    launch: vi.fn<MultiRunRoutesService['launch']>(),
    discard: vi.fn<MultiRunRoutesService['discard']>(),
    fuse: vi.fn<MultiRunRoutesService['fuse']>(),
  }
}

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

function fuseBody(overrides: Partial<FuseMultiRunRequest> = {}): FuseMultiRunRequest {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    entryIds: [1, 2],
    model: 'openai/a',
    ...overrides,
  }
}

describe('internal-multi-runs routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let multiRuns: MultiRunFakes
  let app: Hono
  let token: string

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  beforeEach(() => {
    db = createTestDatabase()
    multiRuns = createMultiRunFakes()
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { multiRuns }))
  })

  afterEach(() => {
    db.close()
  })

  it('GET /api/internal/multi-runs returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/multi-runs?repoId=1')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/multi-runs returns the repository runs with a bearer token', async () => {
    multiRuns.list.mockReturnValue([])

    const res = await app.request('/api/internal/multi-runs?repoId=1', { headers: authHeaders() })
    const body = await readJson(res, MultiRunsResponseSchema)

    expect(res.status).toBe(200)
    expect(body.runs).toEqual([])
    expect(multiRuns.list).toHaveBeenCalledWith({ kind: 'repo', repoId: 1 })
  })

  it('POST /api/internal/multi-runs/3/entries/4/discard discards the entry', async () => {
    const run = createRun()
    multiRuns.discard.mockResolvedValue(run)

    const res = await app.request('/api/internal/multi-runs/3/entries/4/discard', {
      method: 'POST',
      headers: authHeaders(),
    })
    const body = await readJson(res, MultiRunResponseSchema)

    expect(res.status).toBe(200)
    expect(body.run).toEqual(run)
    expect(multiRuns.discard).toHaveBeenCalledWith(3, 4)
  })

  it('POST /api/internal/multi-runs/3/fusions fuses the run', async () => {
    const run = createRun()
    multiRuns.fuse.mockResolvedValue({ run, created: true })
    const body = fuseBody()

    const res = await app.request('/api/internal/multi-runs/3/fusions', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = await readJson(res, MultiRunResponseSchema)

    expect(res.status).toBe(201)
    expect(parsed.run).toEqual(run)
    expect(multiRuns.fuse).toHaveBeenCalledWith(3, body)
  })
})
