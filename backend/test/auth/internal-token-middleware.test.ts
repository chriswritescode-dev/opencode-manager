import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalTokenMiddleware } from '../../src/auth/internal-token-middleware'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import migration013 from '../../src/db/migrations/013-app-secrets'

describe('internal-token-middleware', () => {
  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration013.up(db)
    return db
  }

  function createTestApp(db: Database) {
    const app = new Hono()
    app.use('/*', createInternalTokenMiddleware(db))
    app.get('/test', (c) => c.json({ ok: true }))
    return app
  }

  it('returns 401 when authorization header is missing', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when authorization header is not bearer or basic scheme', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Digest abc123' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is wrong', async () => {
    const db = createTestDb()
    const validToken = getOrCreateInternalToken(db)
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${validToken}wrong` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token has different length', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Bearer short' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when bearer token matches', async () => {
    const db = createTestDb()
    const token = getOrCreateInternalToken(db)
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 401 when basic auth password is wrong', async () => {
    const db = createTestDb()
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from('opencode:wrong-password').toString('base64') },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when basic auth password matches internal token', async () => {
    const db = createTestDb()
    const token = getOrCreateInternalToken(db)
    const app = createTestApp(db)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from(`opencode:${token}`).toString('base64') },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})
