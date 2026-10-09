import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { ChangeWalkthroughService } from '../../src/services/change-walkthroughs'
import { createInternalTestApp } from '../helpers/internal-test-app'

const SESSION_ID = 'ses_walkthrough'

describe('internal/change-walkthroughs routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let startGeneration: ReturnType<typeof vi.fn>
  let getState: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    startGeneration = vi.fn(async () => ({
      walkthrough: null,
      currentDiffHash: 'hash',
      stale: false,
      generating: true,
      error: null,
    }))
    getState = vi.fn(async () => ({
      walkthrough: null,
      currentDiffHash: 'hash',
      stale: false,
      generating: false,
      error: null,
    }))

    app = new Hono()
    app.route(
      '/api/internal',
      createInternalTestApp(db, { changeWalkthroughService: { startGeneration, getState } as unknown as ChangeWalkthroughService }),
    )
    token = getOrCreateInternalToken(db)
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
    await expect(res.json()).resolves.toMatchObject({ generating: true })
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
    expect(getState).toHaveBeenCalledWith(SESSION_ID, { kind: 'staged' }, undefined)
  })
})
