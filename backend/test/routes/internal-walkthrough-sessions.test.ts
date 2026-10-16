import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { ChangeWalkthroughService } from '../../src/services/change-walkthroughs'
import { ChangeWalkthroughError } from '../../src/services/change-walkthrough-error'
import { createInternalTestApp } from '../helpers/internal-test-app'

const SESSION_ID = 'ses_walk'

describe('internal/walkthrough-sessions routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let readChangesForWalkthroughSession: ReturnType<typeof vi.fn>
  let publishFromWalkthroughSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    readChangesForWalkthroughSession = vi.fn(async () => '## Outline')
    publishFromWalkthroughSession = vi.fn(async () => ({ path: '/workspace/walkthroughs/ses_walk/gen/index.html' }))

    app = new Hono()
    app.route(
      '/api/internal',
      createInternalTestApp(db, {
        changeWalkthroughService: {
          readChangesForWalkthroughSession,
          publishFromWalkthroughSession,
        } as unknown as ChangeWalkthroughService,
      }),
    )
    token = getOrCreateInternalToken(db)
  })

  it('POST /api/internal/walkthrough-sessions/:id/changes returns 401 without a bearer token', async () => {
    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, { method: 'POST' })

    expect(res.status).toBe(401)
    expect(readChangesForWalkthroughSession).not.toHaveBeenCalled()
  })

  it('POST /changes returns the outline with an empty body', async () => {
    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ text: '## Outline' })
    expect(readChangesForWalkthroughSession).toHaveBeenCalledWith(SESSION_ID, undefined)
  })

  it('POST /changes forwards the requested file', async () => {
    readChangesForWalkthroughSession.mockResolvedValueOnce('diff')

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'src/a.ts' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ text: 'diff' })
    expect(readChangesForWalkthroughSession).toHaveBeenCalledWith(SESSION_ID, 'src/a.ts')
  })

  it('POST /changes maps a service error', async () => {
    readChangesForWalkthroughSession.mockRejectedValueOnce(
      new ChangeWalkthroughError('This session is not a walkthrough session', 404, { code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION' }),
    )

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/changes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: 'This session is not a walkthrough session',
      code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
    })
  })

  it('POST /publish returns the artifact path', async () => {
    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ path: '/workspace/walkthroughs/ses_walk/gen/index.html' })
    expect(publishFromWalkthroughSession).toHaveBeenCalledWith(SESSION_ID)
  })

  it('POST /publish maps a service error', async () => {
    publishFromWalkthroughSession.mockRejectedValueOnce(
      new ChangeWalkthroughError('This session is not a walkthrough session', 404, { code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION' }),
    )

    const res = await app.request(`/api/internal/walkthrough-sessions/${SESSION_ID}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'This session is not a walkthrough session' })
  })
})
