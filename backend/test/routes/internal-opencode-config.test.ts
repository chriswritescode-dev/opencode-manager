import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { UpstreamError, type OpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { OPENCODE_CONFIG_SEED, readOpenCodeConfigFile, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { createTempAssistantWorkspace } from '../helpers/assistant-workspace'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

describe('internal/opencode-config routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let getJsonMock: ReturnType<typeof vi.fn>
  let forwardMock: ReturnType<typeof vi.fn>

  function configPath(name: string): string {
    return path.join(ws.workspacePath, '.config/opencode', name)
  }

  function authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${token}` }
  }

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    getJsonMock = vi.fn(() => Promise.resolve({}))
    forwardMock = vi.fn(() => Promise.resolve(new Response('{}')))
    const openCodeClient = {
      getJson: getJsonMock,
      forward: forwardMock,
    } as unknown as OpenCodeClient
    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, openCodeClient, stubWorktreeManager)
    const notificationService = new NotificationService(db)
    const settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
  })

  afterEach(async () => {
    await ws.cleanup()
  })

  it('GET /api/internal/opencode-config returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-config')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-config returns 404 when no config file exists', async () => {
    const res = await app.request('/api/internal/opencode-config', { headers: authHeaders() })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('No OpenCode config file found')
  })

  it('GET /api/internal/opencode-config returns the merged persisted snapshot and sources', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', { headers: authHeaders() })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      path: string
      content: Record<string, unknown>
      rawContent: string
      isValid: boolean
      updatedAt: number
      sources: Array<{ name: string; path: string; rawContent: string }>
      revision: string
    }
    expect(body.path).toBe(configPath('opencode.jsonc'))
    expect(body.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(body.isValid).toBe(true)
    expect(body.updatedAt).toBeGreaterThan(0)
    expect(body.sources.map((source) => source.name)).toEqual(['opencode.jsonc'])
    expect(body.revision).toMatch(/^[a-f0-9]{64}$/)
  })

  it('PUT /api/internal/opencode-config writes the file, reports restartRequired, and never forwards a PATCH', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: { $schema: 'https://opencode.ai/config.json', plugin: ['x'] } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { restartRequired?: boolean; content: Record<string, unknown> }
    expect(body.restartRequired).toBe(true)
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json', plugin: ['x'] })
    expect(forwardMock).not.toHaveBeenCalled()

    const onDisk = JSON.parse(await readFile(configPath('opencode.jsonc'), 'utf8')) as Record<string, unknown>
    expect(onDisk.plugin).toEqual(['x'])
  })

  it('PUT /api/internal/opencode-config does not report restartRequired for a comment-only edit', async () => {
    await writeOpenCodeConfigFile('{"theme":"dark"}', 'opencode.json')
    const commented = '{\n  // keep this comment\n  "theme": "dark"\n}\n'

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: commented, source: 'opencode.json' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { restartRequired?: boolean }
    expect(body.restartRequired).toBeUndefined()
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(commented)
  })

  it('PUT /api/internal/opencode-config forwards the requested source', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const submitted = '{\n  "theme": "light"\n}\n'

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: submitted, source: 'config.json' }),
    })

    expect(res.status).toBe(200)
    await expect(readFile(configPath('config.json'), 'utf8')).resolves.toBe(submitted)
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(OPENCODE_CONFIG_SEED)
  })

  it('PUT /api/internal/opencode-config returns 409 for a stale expectedRevision', async () => {
    const initial = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    await writeFile(configPath('config.json'), '{"model":"a/b"}', 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: { theme: 'light' }, expectedRevision: initial.revision! }),
    })

    expect(res.status).toBe(409)
    const body = await res.json() as { expectedRevision: string; actualRevision: string }
    expect(body.expectedRevision).toBe(initial.revision!)
    expect(body.actualRevision).not.toBe(initial.revision!)
  })

  it('PUT /api/internal/opencode-config returns 400 for schema-invalid content', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: { model: 5 } }),
    })

    expect(res.status).toBe(400)
  })

  it('PUT /api/internal/opencode-config returns 400 for an invalid JSON body', async () => {
    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: '{',
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid JSON')
  })

  it('GET /api/internal/opencode-config/effective proxies the running global config without writing it back', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const effective = { theme: 'dark', model: 'effective/model' }
    getJsonMock.mockImplementation(() => Promise.resolve(effective))

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(effective)
    expect(getJsonMock).toHaveBeenCalledWith('/global/config')
    const persisted = await readOpenCodeConfigFile()
    expect(persisted?.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
  })

  it('GET /api/internal/opencode-config/effective returns 503 when the server is unavailable', async () => {
    getJsonMock.mockImplementation(() => Promise.reject(new UpstreamError(502, 'Proxy request failed')))

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })

    expect(res.status).toBe(503)
  })
})
