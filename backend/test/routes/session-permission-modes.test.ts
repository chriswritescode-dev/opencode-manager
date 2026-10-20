import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { createSessionPermissionModeRoutes } from '../../src/routes/session-permission-modes'
import { createFakeSessionPermissionClient } from '../helpers/fake-session-permission-client'

function createTestApp(db: Database, parents: Record<string, string | null> = {}): Hono {
  const app = new Hono()
  const client = createFakeSessionPermissionClient({ parents })
  const service = new SessionPermissionModeService(db, client, new SettingsService(db), new SessionAncestry(client))
  app.route('/session-permission-modes', createSessionPermissionModeRoutes(service))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('session permission mode routes', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('GET returns ask for a session with no stored mode', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-permission-modes/ses_root')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      mode: 'ask',
      lockedReason: null,
    })
  })

  it('GET reports the child lock reason for a child session', async () => {
    const app = createTestApp(db, { ses_child: 'ses_root', ses_root: null })

    const res = await app.request('/session-permission-modes/ses_child')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sessionId: 'ses_child',
      rootSessionId: 'ses_root',
      mode: 'ask',
      lockedReason: 'child',
    })
  })

  it('PUT stores a mode and GET reads it back', async () => {
    const app = createTestApp(db)

    const putRes = await app.request('/session-permission-modes/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/abs/repo', mode: 'auto' }),
    })
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      mode: 'auto',
      lockedReason: null,
    })

    const getRes = await app.request('/session-permission-modes/ses_root')
    const body = await getRes.json() as { mode: string }
    expect(body.mode).toBe('auto')
  })

  it('PUT rejects an invalid mode with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-permission-modes/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/abs/repo', mode: 'always' }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: expect.any(String), details: expect.any(Array) })
  })

  it('PUT rejects malformed JSON with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-permission-modes/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('PUT rejects setting the mode of a child session with 400', async () => {
    const app = createTestApp(db, { ses_child: 'ses_root', ses_root: null })

    const res = await app.request('/session-permission-modes/ses_child', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/abs/repo', mode: 'auto' }),
    })
    expect(res.status).toBe(400)
  })

  it('scopes PUT and GET by serverId', async () => {
    const app = createTestApp(db, { ses_root: null })

    const putRes = await app.request('/session-permission-modes/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/abs/repo', mode: 'auto', serverId: 'srv_remote' }),
    })
    expect(putRes.status).toBe(200)

    const remoteRes = await app.request('/session-permission-modes/ses_root?serverId=srv_remote')
    await expect(remoteRes.json()).resolves.toMatchObject({ mode: 'auto' })

    const localRes = await app.request('/session-permission-modes/ses_root')
    await expect(localRes.json()).resolves.toMatchObject({ mode: 'ask' })
  })
})
