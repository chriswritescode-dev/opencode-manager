import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type { ChangeWalkthroughRoutesService } from '../../src/routes/change-walkthroughs'
import { ChangeWalkthroughError } from '../../src/services/change-walkthrough-error'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const SESSION_ID = 'ses_walk'

const ChangesResponseSchema = z.object({ text: z.string() })
const PublishResponseSchema = z.object({ path: z.string() })
const ErrorResponseSchema = z.object({ error: z.string(), code: z.string().optional() })

function createChangeWalkthroughFakes(
  overrides: Partial<ChangeWalkthroughRoutesService> = {},
): ChangeWalkthroughRoutesService {
  return {
    cancelGeneration: vi.fn<ChangeWalkthroughRoutesService['cancelGeneration']>(async () => true),
    getState: vi.fn<ChangeWalkthroughRoutesService['getState']>(),
    listHelperSessionIds: vi.fn<ChangeWalkthroughRoutesService['listHelperSessionIds']>(() => []),
    publishFromWalkthroughSession: vi.fn<ChangeWalkthroughRoutesService['publishFromWalkthroughSession']>(
      async () => ({ path: '/workspace/walkthroughs/ses_walk/gen/index.html' }),
    ),
    readChangesForWalkthroughSession: vi.fn<ChangeWalkthroughRoutesService['readChangesForWalkthroughSession']>(
      async () => '## Outline',
    ),
    refine: vi.fn<ChangeWalkthroughRoutesService['refine']>(),
    startGeneration: vi.fn<ChangeWalkthroughRoutesService['startGeneration']>(),
    ...overrides,
  }
}

function createWalkthroughApp(
  db: Database,
  overrides: Partial<ChangeWalkthroughRoutesService> = {},
) {
  const app = new Hono()
  app.route(
    '/api/internal',
    createInternalTestApp(db, { changeWalkthroughService: createChangeWalkthroughFakes(overrides) }),
  )
  return { app, token: getOrCreateInternalToken(db) }
}

describe('internal/walkthrough-sessions routes', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('POST /api/internal/walkthrough-sessions/:id/changes returns 401 without a bearer token', async () => {
    const readChangesForWalkthroughSession = vi.fn<
      ChangeWalkthroughRoutesService['readChangesForWalkthroughSession']
    >(async () => '## Outline')
    const { app } = createWalkthroughApp(db, { readChangesForWalkthroughSession })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, { method: 'POST' })

    expect(res.status).toBe(401)
    expect(readChangesForWalkthroughSession).not.toHaveBeenCalled()
  })

  it('POST /changes returns the outline with an empty body', async () => {
    const readChangesForWalkthroughSession = vi.fn<
      ChangeWalkthroughRoutesService['readChangesForWalkthroughSession']
    >(async () => '## Outline')
    const { app, token } = createWalkthroughApp(db, { readChangesForWalkthroughSession })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, ChangesResponseSchema)).toEqual({ text: '## Outline' })
    expect(readChangesForWalkthroughSession).toHaveBeenCalledWith(SESSION_ID, undefined)
  })

  it('POST /changes forwards the requested file', async () => {
    const readChangesForWalkthroughSession = vi.fn<
      ChangeWalkthroughRoutesService['readChangesForWalkthroughSession']
    >(async () => 'diff')
    const { app, token } = createWalkthroughApp(db, { readChangesForWalkthroughSession })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'src/a.ts' }),
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, ChangesResponseSchema)).toEqual({ text: 'diff' })
    expect(readChangesForWalkthroughSession).toHaveBeenCalledWith(SESSION_ID, 'src/a.ts')
  })

  it('POST /changes maps a service error', async () => {
    const { app, token } = createWalkthroughApp(db, {
      readChangesForWalkthroughSession: vi.fn(async () => {
        throw new ChangeWalkthroughError('This session is not a walkthrough session', 404, {
          code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
        })
      }),
    })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
    expect(await readJson(res, ErrorResponseSchema)).toMatchObject({
      error: 'This session is not a walkthrough session',
      code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
    })
  })

  it('POST /publish returns the artifact path', async () => {
    const publishFromWalkthroughSession = vi.fn<
      ChangeWalkthroughRoutesService['publishFromWalkthroughSession']
    >(async () => ({ path: '/workspace/walkthroughs/ses_walk/gen/index.html' }))
    const { app, token } = createWalkthroughApp(db, { publishFromWalkthroughSession })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, PublishResponseSchema)).toEqual({
      path: '/workspace/walkthroughs/ses_walk/gen/index.html',
    })
    expect(publishFromWalkthroughSession).toHaveBeenCalledWith(SESSION_ID)
  })

  it('POST /publish maps a service error', async () => {
    const { app, token } = createWalkthroughApp(db, {
      publishFromWalkthroughSession: vi.fn(async () => {
        throw new ChangeWalkthroughError('This session is not a walkthrough session', 404, {
          code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
        })
      }),
    })

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
    expect(await readJson(res, ErrorResponseSchema)).toMatchObject({
      error: 'This session is not a walkthrough session',
    })
  })
})
