import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SessionGoalService, type SessionGoalServiceOptions } from '../../src/services/session-goals'
import { SettingsService } from '../../src/services/settings'
import { createSessionGoalRoutes } from '../../src/routes/session-goals'
import { createFakeSessionGoalClient } from '../helpers/fake-session-goal-client'

const DIRECTORY = '/abs/repo'

function createTestApp(db: Database, serviceOptions: SessionGoalServiceOptions = {}): Hono {
  const app = new Hono()
  const service = new SessionGoalService(
    db,
    createFakeSessionGoalClient({ busySessions: ['ses_1'] }).client,
    new SettingsService(db),
    serviceOptions,
  )
  app.route('/session-goals', createSessionGoalRoutes(service))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function startBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it', ...overrides })
}

describe('session goal routes', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('GET returns a null goal for a session with no goal', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-goals?sessionId=ses_1')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ goal: null })
  })

  it('GET rejects a missing sessionId with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-goals')

    expect(res.status).toBe(400)
  })

  it('POST creates a goal and GET reads it back', async () => {
    const app = createTestApp(db)

    const postRes = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })
    expect(postRes.status).toBe(201)
    const created = await postRes.json() as { goal: { id: number; status: string } }
    expect(created.goal.status).toBe('active')

    const getRes = await app.request('/session-goals?sessionId=ses_1')
    const body = await getRes.json() as { goal: { id: number } }
    expect(body.goal.id).toBe(created.goal.id)
  })

  it('POST rejects an invalid body with 400 and details', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_1', directory: DIRECTORY, objective: '' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; details: unknown[] }
    expect(body.error).toBe('Invalid request body')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('POST rejects malformed JSON with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('POST rejects a scheduled run session with 409', async () => {
    const app = createTestApp(db, { resolveSessionLock: async () => 'schedule' })

    const res = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Scheduled runs cannot run goals' })
  })

  it('POST rejects a child session with 400', async () => {
    const app = createTestApp(db, { resolveSessionLock: async () => 'child' })

    const res = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Goals can only be started on top-level sessions' })
  })

  it('POST rejects a second open goal with 409', async () => {
    const app = createTestApp(db)
    await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })

    const res = await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })

    expect(res.status).toBe(409)
  })

  it('POST pause and cancel change the goal state', async () => {
    const app = createTestApp(db)
    const created = await (await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })).json() as { goal: { id: number } }

    const pauseRes = await app.request(`/session-goals/${created.goal.id}/pause`, { method: 'POST' })
    expect(pauseRes.status).toBe(200)
    const paused = await pauseRes.json() as { goal: { status: string; stopReason: string } }
    expect(paused.goal).toMatchObject({ status: 'paused', stopReason: 'user_paused' })

    const cancelRes = await app.request(`/session-goals/${created.goal.id}/cancel`, { method: 'POST' })
    expect(cancelRes.status).toBe(200)
    const cancelled = await cancelRes.json() as { goal: { status: string; stopReason: string } }
    expect(cancelled.goal).toMatchObject({ status: 'stopped', stopReason: 'cancelled' })
  })

  it('POST resume reopens a paused goal', async () => {
    const app = createTestApp(db)
    const created = await (await app.request('/session-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startBody(),
    })).json() as { goal: { id: number } }
    await app.request(`/session-goals/${created.goal.id}/pause`, { method: 'POST' })

    const resumeRes = await app.request(`/session-goals/${created.goal.id}/resume`, { method: 'POST' })

    expect(resumeRes.status).toBe(200)
    const resumed = await resumeRes.json() as { goal: { status: string } }
    expect(resumed.goal.status).toBe('active')
  })

  it('POST pause of a missing goal returns 404', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-goals/999/pause', { method: 'POST' })

    expect(res.status).toBe(404)
  })
})
