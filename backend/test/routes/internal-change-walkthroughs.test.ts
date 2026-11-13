import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Hono } from 'hono'
import type { ChangeWalkthroughState } from '@opencode-manager/shared/schemas'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type { ChangeWalkthroughRoutesService } from '../../src/routes/change-walkthroughs'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'
import { ChangeWalkthroughStateSchema } from '@opencode-manager/shared/schemas'

const SESSION_ID = 'ses_walkthrough'

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return {
    walkthrough: null,
    currentDiffHash: 'hash',
    hasChanges: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

function createChangeWalkthroughFakes(
  overrides: Partial<ChangeWalkthroughRoutesService> = {},
): ChangeWalkthroughRoutesService {
  return {
    cancelGeneration: vi.fn<ChangeWalkthroughRoutesService['cancelGeneration']>(async () => true),
    getState: vi.fn<ChangeWalkthroughRoutesService['getState']>(async () => state()),
    listHelperSessionIds: vi.fn<ChangeWalkthroughRoutesService['listHelperSessionIds']>(() => []),
    publishFromWalkthroughSession: vi.fn<ChangeWalkthroughRoutesService['publishFromWalkthroughSession']>(
      async () => ({ path: '/tmp/walkthrough.md' }),
    ),
    readChangesForWalkthroughSession: vi.fn<ChangeWalkthroughRoutesService['readChangesForWalkthroughSession']>(
      async () => '',
    ),
    refine: vi.fn<ChangeWalkthroughRoutesService['refine']>(async () => state()),
    startGeneration: vi.fn<ChangeWalkthroughRoutesService['startGeneration']>(async () => state({ generating: true })),
    ...overrides,
  }
}

describe('internal/change-walkthroughs routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let app: Hono
  let token: string
  let startGeneration: Mock<ChangeWalkthroughRoutesService['startGeneration']>
  let getState: Mock<ChangeWalkthroughRoutesService['getState']>

  beforeEach(() => {
    db = createTestDatabase()
    startGeneration = vi.fn<ChangeWalkthroughRoutesService['startGeneration']>(async () => state({ generating: true }))
    getState = vi.fn<ChangeWalkthroughRoutesService['getState']>(async () => state())

    app = new Hono()
    app.route(
      '/api/internal',
      createInternalTestApp(db, {
        changeWalkthroughService: createChangeWalkthroughFakes({ startGeneration, getState }),
      }),
    )
    token = getOrCreateInternalToken(db)
  })

  afterEach(() => {
    db.close()
  })

  it('POST /api/internal/change-walkthroughs/:id returns 401 without a bearer token', async () => {
    const res = await app.request(`/api/internal/change-walkthroughs/${SESSION_ID}`, { method: 'POST' })

    expect(res.status).toBe(401)
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('POST /api/internal/change-walkthroughs/:id starts generation with the session id and source', async () => {
    const res = await app.request(`/api/internal/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'staged' } }),
    })

    expect(res.status).toBe(202)
    expect(startGeneration).toHaveBeenCalledTimes(1)
    expect(startGeneration).toHaveBeenCalledWith(SESSION_ID, { source: { kind: 'staged' } })
    const body = await readJson(res, ChangeWalkthroughStateSchema)
    expect(body.generating).toBe(true)
  })

  it('POST /api/internal/change-walkthroughs/:id accepts an empty body', async () => {
    const res = await app.request(`/api/internal/change-walkthroughs/${SESSION_ID}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(202)
    expect(startGeneration).toHaveBeenCalledWith(SESSION_ID, {})
  })

  it('GET /api/internal/change-walkthroughs/:id reads the requested source', async () => {
    const res = await app.request(`/api/internal/change-walkthroughs/${SESSION_ID}?source=staged`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(getState).toHaveBeenCalledWith(SESSION_ID, { kind: 'staged' })
  })
})
