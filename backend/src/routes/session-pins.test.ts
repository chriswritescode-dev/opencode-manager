import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { createSessionPinRoutes } from './session-pins'

function createTestApp(db: Database): Hono {
  const app = new Hono()
  app.route('/session-pins', createSessionPinRoutes(db))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('session pins routes', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
  })

  afterEach(() => {
    db.close()
  })

  it('GET / returns empty pins list initially', async () => {
    const res = await app.request('/session-pins')
    expect(res.status).toBe(200)
    const data = await res.json() as { pins: unknown[] }
    expect(data.pins).toEqual([])
  })

  it('PUT / creates a pin and returns updated list', async () => {
    const res = await app.request('/session-pins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_1', directory: '/w/a', pinned: true }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { pins: Array<{ sessionId: string; directory: string }> }
    expect(data.pins).toHaveLength(1)
    expect(data.pins[0]).toMatchObject({ sessionId: 'ses_1', directory: '/w/a' })
  })

  it('GET / returns pins after creation', async () => {
    await app.request('/session-pins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_1', directory: '/w/a', pinned: true }),
    })

    const res = await app.request('/session-pins')
    expect(res.status).toBe(200)
    const data = await res.json() as { pins: unknown[] }
    expect(data.pins).toHaveLength(1)
  })

  it('PUT / with pinned: false removes the pin', async () => {
    await app.request('/session-pins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_1', directory: '/w/a', pinned: true }),
    })

    const res = await app.request('/session-pins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_1', directory: '/w/a', pinned: false }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { pins: unknown[] }
    expect(data.pins).toHaveLength(0)
  })

  it('PUT / with invalid body returns 400', async () => {
    const res = await app.request('/session-pins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '', directory: '/w/a', pinned: true }),
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Invalid request')
  })
})
