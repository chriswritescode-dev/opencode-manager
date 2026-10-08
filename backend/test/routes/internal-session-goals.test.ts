import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionGoalService } from '../../src/services/session-goals'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { createInternalTestApp } from '../helpers/internal-test-app'

function createSessionGoalStub() {
  return {
    getLatest: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  }
}

describe('internal-session-goals routes', () => {
  let db: Database
  let sessionGoals: ReturnType<typeof createSessionGoalStub>
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    sessionGoals = createSessionGoalStub()
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { sessionGoals: sessionGoals as unknown as SessionGoalService }))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/session-goals returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/session-goals?sessionId=ses_1')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/session-goals returns the latest goal with a bearer token', async () => {
    sessionGoals.getLatest.mockReturnValue(null)

    const res = await app.request('/api/internal/session-goals?sessionId=ses_1', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ goal: null })
    expect(sessionGoals.getLatest).toHaveBeenCalledWith('ses_1')
  })

  it('POST /api/internal/session-goals starts a goal', async () => {
    sessionGoals.start.mockResolvedValue({ id: 1, status: 'active' })
    const body = { sessionId: 'ses_1', directory: '/abs/repo', objective: 'Ship it' }

    const res = await app.request('/api/internal/session-goals', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ goal: { id: 1, status: 'active' } })
    expect(sessionGoals.start).toHaveBeenCalledWith(body)
  })

  it('POST /api/internal/session-goals/7/pause pauses the goal', async () => {
    sessionGoals.pause.mockReturnValue({ id: 7, status: 'paused' })

    const res = await app.request('/api/internal/session-goals/7/pause', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ goal: { id: 7, status: 'paused' } })
    expect(sessionGoals.pause).toHaveBeenCalledWith(7)
  })
})
