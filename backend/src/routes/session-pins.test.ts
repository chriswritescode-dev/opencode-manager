import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { SessionPinSchema } from '@opencode-manager/shared/schemas'
import { createTestDatabase } from '../../test/helpers/test-database'
import { readJson } from '../../test/helpers/read-json'
import { createSessionPinRoutes } from './session-pins'

const SessionPinListSchema = z.object({ pins: z.array(SessionPinSchema) })
const ErrorSchema = z.object({ error: z.string() })

async function togglePin(app: Hono, sessionId: string, directory: string, pinned: boolean): Promise<Response> {
  return app.request('/session-pins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, directory, pinned }),
  })
}

describe('session pins routes', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDatabase()
    app = new Hono()
    app.route('/session-pins', createSessionPinRoutes(db))
  })

  afterEach(() => {
    db.close()
  })

  it('GET / returns empty pins list initially', async () => {
    const res = await app.request('/session-pins')
    expect(res.status).toBe(200)
    expect((await readJson(res, SessionPinListSchema)).pins).toEqual([])
  })

  it('PUT / creates a pin and returns updated list', async () => {
    const res = await togglePin(app, 'ses_1', '/w/a', true)
    expect(res.status).toBe(200)
    const { pins } = await readJson(res, SessionPinListSchema)
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ sessionId: 'ses_1', directory: '/w/a' })

    const listRes = await app.request('/session-pins')
    expect(listRes.status).toBe(200)
    expect((await readJson(listRes, SessionPinListSchema)).pins).toHaveLength(1)
  })

  it('PUT / with pinned: false removes the pin', async () => {
    await togglePin(app, 'ses_1', '/w/a', true)

    const res = await togglePin(app, 'ses_1', '/w/a', false)
    expect(res.status).toBe(200)
    expect((await readJson(res, SessionPinListSchema)).pins).toHaveLength(0)
  })

  it('PUT / with invalid body returns 400', async () => {
    const res = await togglePin(app, '', '/w/a', true)
    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('Invalid request')
  })
})
