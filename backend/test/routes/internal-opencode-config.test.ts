import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { SettingsService } from '../../src/services/settings'
import { ClientError } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { OPENCODE_CONFIG_SEED, readOpenCodeConfigFile, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { createTempAssistantWorkspace } from '../helpers/assistant-workspace'
import { createInternalTestApp } from '../helpers/internal-test-app'

describe('internal/opencode-config routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let configGetMock: ReturnType<typeof vi.fn>
  let forwardRawMock: ReturnType<typeof vi.fn>
  let locationReloadMock: ReturnType<typeof vi.fn>
  let mcpListMock: ReturnType<typeof vi.fn>
  let mcpAddMock: ReturnType<typeof vi.fn>
  let mcpRemoveMock: ReturnType<typeof vi.fn>

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
    configGetMock = vi.fn(() => Promise.resolve([]))
    forwardRawMock = vi.fn(() => Promise.resolve(new Response('{}')))
    locationReloadMock = vi.fn(() => Promise.resolve())
    mcpListMock = vi.fn(() => Promise.resolve({ data: [] }))
    mcpAddMock = vi.fn(() => Promise.resolve())
    mcpRemoveMock = vi.fn(() => Promise.resolve())
    const openCodeClient = {
      api: {
        config: { get: configGetMock },
        location: { reload: locationReloadMock },
        mcp: { list: mcpListMock, add: mcpAddMock, remove: mcpRemoveMock },
      },
      forwardRaw: forwardRawMock,
    } as unknown as OpenCodeClient
    const settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { settingsService, openCodeClient }))
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

  it('GET /api/internal/opencode-config returns the merged snapshot with secrets redacted and no raw source', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        providers: { example: { apiKey: 'secret-key' } },
        mcp: {
          servers: {
            linear: {
              type: 'remote',
              url: 'https://linear.example.com',
              headers: { Authorization: 'Bearer secret' },
            },
          },
        },
      }),
      'opencode.jsonc',
    )

    const res = await app.request('/api/internal/opencode-config', { headers: authHeaders() })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      path: string
      content: Record<string, unknown>
      rawContent?: string
      isValid: boolean
      updatedAt: number
      sources: Array<{ name: string; path: string; content: Record<string, unknown>; rawContent?: string }>
      revision: string
      redactedPaths: string[]
    }
    expect(body.path).toBe(configPath('opencode.jsonc'))
    expect(body.rawContent).toBeUndefined()
    expect(body.sources[0] && 'rawContent' in body.sources[0]).toBe(false)
    expect(body.content).toEqual({
      $schema: 'https://opencode.ai/config.json',
      providers: { example: { apiKey: '<redacted>' } },
      mcp: {
        servers: {
          linear: {
            type: 'remote',
            url: 'https://linear.example.com',
            headers: { Authorization: '<redacted>' },
          },
        },
      },
    })
    expect(body.isValid).toBe(true)
    expect(body.updatedAt).toBeGreaterThan(0)
    expect(body.sources.map((source) => source.name)).toEqual(['opencode.jsonc'])
    expect(body.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(body.redactedPaths).toEqual([
      'mcp.servers.linear.headers.Authorization',
      'providers.example.apiKey',
    ])
  })

  it('PATCH /api/internal/opencode-config merges only the named paths and reloads the server', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark', small_model: 's' }), 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        patch: { mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } } },
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { content: Record<string, unknown>; rawContent?: string }
    expect(body.content).toEqual({
      theme: 'dark',
      small_model: 's',
      mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } },
    })
    expect(body.rawContent).toBeUndefined()
    expect('rawContent' in body).toBe(false)
    expect(mcpAddMock).not.toHaveBeenCalled()
    expect(locationReloadMock).toHaveBeenCalledTimes(1)
    const onDisk = JSON.parse(await readFile(configPath('opencode.jsonc'), 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual(body.content)
  })

  it('PATCH /api/internal/opencode-config returns a redacted body without raw source', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({ theme: 'dark', provider: { example: { apiKey: 'secret-key' } } }),
      'opencode.jsonc',
    )

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ patch: { provider: { example: { apiKey: 'updated-secret' } } } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      content: Record<string, unknown>
      rawContent?: string
      sources: Array<{ content: Record<string, unknown>; rawContent?: string }>
      redactedPaths: string[]
    }
    expect(body.rawContent).toBeUndefined()
    expect('rawContent' in body).toBe(false)
    expect(body.sources[0] && 'rawContent' in body.sources[0]).toBe(false)
    expect(body.content).toEqual({
      theme: 'dark',
      provider: { example: { apiKey: '<redacted>' } },
    })
    expect(body.redactedPaths).toEqual(['provider.example.apiKey'])
  })

  it('PATCH /api/internal/opencode-config rejects a redacted placeholder without writing', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark' }), 'opencode.jsonc')
    const before = await readFile(configPath('opencode.jsonc'), 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ patch: { provider: { example: { apiKey: '<redacted>' } } } }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; paths: string[] }
    expect(body.paths).toEqual(['provider.example.apiKey'])
    expect(body.error).toContain('redacted placeholder')
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(before)
  })

  it('PUT /api/internal/opencode-config rejects a redacted placeholder in raw content without writing', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark' }), 'opencode.jsonc')
    const before = await readFile(configPath('opencode.jsonc'), 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        content: '{\n  // keep\n  "provider": { "example": { "apiKey": "<redacted>" } }\n}\n',
        source: 'opencode.jsonc',
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; paths: string[] }
    expect(body.paths).toEqual(['provider.example.apiKey'])
    expect(body.error).toContain('redacted placeholder')
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(before)
  })

  it('PATCH /api/internal/opencode-config reloads for a non-mcp change', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark' }), 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ patch: { theme: 'light' } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { content: Record<string, unknown> }
    expect(body.content).toEqual({ theme: 'light' })
    expect(locationReloadMock).toHaveBeenCalledTimes(1)
  })

  it('PATCH /api/internal/opencode-config returns 409 for a stale expectedRevision', async () => {
    const initial = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    await writeFile(configPath('opencode.json'), '{"model":"a/b"}', 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ patch: { theme: 'light' }, expectedRevision: initial.revision }),
    })

    expect(res.status).toBe(409)
    const body = await res.json() as { expectedRevision: string; actualRevision: string }
    expect(body.expectedRevision).toBe(initial.revision!)
    expect(body.actualRevision).not.toBe(initial.revision!)
  })

  it('GET /api/internal/opencode-config/mcp lists configured servers with redacted config and live status', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({
        mcp: {
          servers: {
            linear: {
              type: 'remote',
              url: 'https://linear.example.com',
              headers: { Authorization: 'Bearer secret' },
            },
            local: { type: 'local', command: ['npx', 'local'], disabled: true },
          },
          legacy: { type: 'local', command: ['npx', 'legacy'], enabled: false },
        },
      }),
      'opencode.jsonc',
    )
    mcpListMock.mockResolvedValue({
      data: [
        { name: 'linear', status: { status: 'connected' } },
        { name: 'local', status: { status: 'disabled' } },
      ],
    })

    const res = await app.request('/api/internal/opencode-config/mcp', { headers: authHeaders() })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      revision: string | null
      servers: Array<{
        name: string
        type: string
        command?: string[]
        url?: string
        enabled: boolean
        shape: string
        status?: string
      }>
    }
    expect(body.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(body.servers).toEqual([
      { name: 'legacy', type: 'local', command: ['npx', 'legacy'], enabled: false, shape: 'legacy' },
      { name: 'linear', type: 'remote', url: 'https://linear.example.com', enabled: true, shape: 'servers', status: 'connected' },
      { name: 'local', type: 'local', command: ['npx', 'local'], enabled: false, shape: 'servers', status: 'disabled' },
    ])
    expect(mcpListMock).toHaveBeenCalledWith({ location: { directory: ws.workspacePath } })
  })

  it('GET /api/internal/opencode-config/mcp returns config-only when the server is unreachable', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({ mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } } }),
      'opencode.jsonc',
    )
    mcpListMock.mockRejectedValue(new Error('unreachable'))

    const res = await app.request('/api/internal/opencode-config/mcp', { headers: authHeaders() })

    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Array<Record<string, unknown>> }
    expect(body.servers).toEqual([
      { name: 'local', type: 'local', command: ['npx', 'local'], enabled: true, shape: 'servers' },
    ])
  })

  it('PUT /api/internal/opencode-config writes the file and applies it through a location reload without a restart', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: { $schema: 'https://opencode.ai/config.json', plugin: ['x'] } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { restartRequired?: boolean; content: Record<string, unknown> }
    expect(body.restartRequired).toBeUndefined()
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json', plugin: ['x'] })
    expect(locationReloadMock).toHaveBeenCalledTimes(1)
    expect(configGetMock).not.toHaveBeenCalled()
    expect(forwardRawMock).not.toHaveBeenCalled()

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
    expect(locationReloadMock).not.toHaveBeenCalled()
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(commented)
  })

  it('PUT /api/internal/opencode-config forwards the requested source', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const submitted = '{\n  "theme": "light"\n}\n'

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: submitted, source: 'opencode.json' }),
    })

    expect(res.status).toBe(200)
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(submitted)
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(OPENCODE_CONFIG_SEED)
  })

  it('PUT /api/internal/opencode-config returns a redacted body without raw source', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        content: { $schema: 'https://opencode.ai/config.json', provider: { example: { apiKey: 'secret-key' } } },
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      content: Record<string, unknown>
      rawContent?: string
      sources: Array<{ content: Record<string, unknown>; rawContent?: string }>
      redactedPaths: string[]
    }
    expect(body.rawContent).toBeUndefined()
    expect('rawContent' in body).toBe(false)
    expect(body.sources[0] && 'rawContent' in body.sources[0]).toBe(false)
    expect(body.content).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: { example: { apiKey: '<redacted>' } },
    })
    expect(body.redactedPaths).toEqual(['provider.example.apiKey'])
  })

  it('PUT /api/internal/opencode-config returns 409 for a stale expectedRevision', async () => {
    const initial = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    await writeFile(configPath('opencode.json'), '{"model":"a/b"}', 'utf8')

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

  it('PUT /api/internal/opencode-config returns 409 for a shadowed removal', async () => {
    const lower = '{"theme":"light","model":"a"}'
    const target = '{"model":"b"}'
    await writeOpenCodeConfigFile(target, 'opencode.jsonc')
    await writeFile(configPath('opencode.json'), lower, 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: { model: 'b' } }),
    })

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; paths: string[]; sources: string[] }
    expect(body.paths).toEqual(['theme'])
    expect(body.sources).toEqual(['opencode.json'])
    expect(body.error).toContain('Cannot remove theme')
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(lower)
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
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

  it('GET /api/internal/opencode-config/effective redacts document config entries without writing them back', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const entries = [
      {
        type: 'document',
        path: configPath('opencode.jsonc'),
        info: { theme: 'dark', provider: { example: { apiKey: 'secret-key' } } },
      },
      { type: 'directory', path: path.join(ws.workspacePath, '.config', 'opencode') },
    ]
    configGetMock.mockImplementation(() => Promise.resolve(entries))

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      entries: [
        {
          type: 'document',
          path: configPath('opencode.jsonc'),
          info: { theme: 'dark', provider: { example: { apiKey: '<redacted>' } } },
        },
        { type: 'directory', path: path.join(ws.workspacePath, '.config', 'opencode') },
      ],
    })
    expect(configGetMock).toHaveBeenCalledWith({ location: { directory: ws.workspacePath } })
    const persisted = await readOpenCodeConfigFile()
    expect(persisted?.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
  })

  it('GET /api/internal/opencode-config/effective returns 503 when the server is unreachable', async () => {
    configGetMock.mockImplementation(() => Promise.reject(new ClientError('Transport')))

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })

    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('OpenCode server unavailable')
  })

  it('GET /api/internal/opencode-config/effective returns 502 when the server rejects the request', async () => {
    configGetMock.mockImplementation(() => Promise.reject(new ClientError('UnexpectedStatus')))

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })

    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Failed to get effective OpenCode config')
  })
})
