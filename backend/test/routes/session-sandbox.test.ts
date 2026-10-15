import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { SessionSandboxService } from '../../src/services/session-sandbox'
import { parseMemoryMib } from '../../src/services/sandbox/command'
import { createSessionSandboxRoutes } from '../../src/routes/session-sandbox'
import { createFakeSessionPermissionClient } from '../helpers/fake-session-permission-client'

const ENV_RESOURCES = { cpus: ENV.SANDBOX.CPUS, memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0 }

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createTestApp(
  db: Database,
  options: { parents?: Record<string, string | null>; sandboxEnabled?: boolean } = {},
): Hono {
  const settingsService = new SettingsService(db)
  if (options.sandboxEnabled) {
    settingsService.updateSettings({ sandbox: { enabled: true } })
  }
  const client = createFakeSessionPermissionClient({ parents: options.parents ?? {} })
  const service = new SessionSandboxService(db, new SessionAncestry(client), settingsService, {
    removeSessionSandbox: async () => undefined,
  })
  const app = new Hono()
  app.route('/session-sandbox', createSessionSandboxRoutes(service))
  return app
}

describe('session sandbox routes', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('GET reports unavailable and unsandboxed when server support is disabled', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-sandbox/ses_root')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'default',
      resources: null,
      effectiveResources: ENV_RESOURCES,
      lockedReason: null,
      available: false,
    })
  })

  it('GET reports the default sandboxed value when server support is enabled', async () => {
    const app = createTestApp(db, { sandboxEnabled: true })

    const res = await app.request('/session-sandbox/ses_root')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: true,
      source: 'default',
      resources: null,
      effectiveResources: ENV_RESOURCES,
      lockedReason: null,
      available: true,
    })
  })

  it('GET reports the child lock reason for a child session', async () => {
    const app = createTestApp(db, { parents: { ses_child: 'ses_root', ses_root: null }, sandboxEnabled: true })

    const res = await app.request('/session-sandbox/ses_child')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      sessionId: 'ses_child',
      rootSessionId: 'ses_root',
      sandboxed: true,
      lockedReason: 'child',
      available: true,
    })
  })

  it('PUT stores a value and GET reads it back', async () => {
    const app = createTestApp(db, { sandboxEnabled: true })

    const putRes = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxed: false }),
    })
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toMatchObject({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      available: true,
    })

    const getRes = await app.request('/session-sandbox/ses_root')
    const body = (await getRes.json()) as { sandboxed: boolean }
    expect(body.sandboxed).toBe(false)
  })

  it('PUT stores a resource override and GET reports it', async () => {
    const app = createTestApp(db, { sandboxEnabled: true })

    const putRes = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resources: { cpus: 4, memoryMib: 8192 } }),
    })
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toMatchObject({
      resources: { cpus: 4, memoryMib: 8192 },
      effectiveResources: { cpus: 4, memoryMib: 8192 },
    })
  })

  it('PUT rejects a resource override above the host limit with 400', async () => {
    const app = createTestApp(db, { sandboxEnabled: true })

    const res = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resources: { cpus: os.availableParallelism() + 1, memoryMib: 1024 } }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('PUT rejects a body without sandboxed or resources with 400', async () => {
    const app = createTestApp(db, { sandboxEnabled: true })

    const res = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('PUT rejects an invalid body with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxed: 'yes' }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: expect.any(String), details: expect.any(Array) })
  })

  it('PUT rejects malformed JSON with 400', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('PUT rejects setting the sandbox flag of a child session with 400', async () => {
    const app = createTestApp(db, { parents: { ses_child: 'ses_root', ses_root: null }, sandboxEnabled: true })

    const res = await app.request('/session-sandbox/ses_child', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxed: false }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT rejects enabling sandboxing with 409 when server support is disabled', async () => {
    const app = createTestApp(db)

    const res = await app.request('/session-sandbox/ses_root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxed: true }),
    })
    expect(res.status).toBe(409)
  })
})
