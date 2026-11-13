import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Hono } from 'hono'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ClientError } from '@opencode-manager/shared/opencode'
import type { ConfigEntry, OpenCodeApi } from '@opencode-manager/shared/opencode'
import { JsonObjectSchema } from '@opencode-manager/shared/utils'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { OPENCODE_CONFIG_SEED, readOpenCodeConfigFile, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { createTempAssistantWorkspace } from '../helpers/assistant-workspace'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const ConfigSourceSchema = z.object({
  name: z.string(),
  path: z.string(),
  content: JsonObjectSchema,
  rawContent: z.string().optional(),
  isValid: z.boolean().optional(),
  updatedAt: z.number().optional(),
})

const ConfigFileSchema = z.object({
  path: z.string(),
  content: JsonObjectSchema,
  rawContent: z.string().optional(),
  isValid: z.boolean(),
  updatedAt: z.number(),
  sources: z.array(ConfigSourceSchema),
  revision: z.string(),
  redactedPaths: z.array(z.string()),
  restartRequired: z.boolean().optional(),
})

const ErrorResponseSchema = z.object({ error: z.string() })
const RevisionConflictSchema = z.object({
  error: z.string(),
  expectedRevision: z.string(),
  actualRevision: z.string(),
})
const ValidationErrorSchema = z.object({
  error: z.string(),
  validationIssues: z.array(z.object({ path: z.string(), message: z.string() })),
})
const PathsErrorSchema = z.object({ error: z.string(), paths: z.array(z.string()) })
const ShadowedRemovalSchema = z.object({
  error: z.string(),
  paths: z.array(z.string()),
  sources: z.array(z.string()),
})
const McpServersSchema = z.object({
  revision: z.string(),
  servers: z.array(z.strictObject({
    name: z.string(),
    type: z.enum(['local', 'remote']),
    command: z.array(z.string()).optional(),
    url: z.string().optional(),
    enabled: z.boolean(),
    status: z.string().optional(),
  })),
})
const EffectiveConfigSchema = z.object({
  entries: z.array(z.union([
    z.object({ type: z.literal('document'), path: z.string(), info: JsonObjectSchema }),
    z.object({ type: z.literal('directory'), path: z.string() }),
  ])),
})
const ManagedConfigSchema = z.object({ info: JsonObjectSchema })

describe('internal/opencode-config routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let app: Hono
  let token: string
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let configGet: Mock<OpenCodeApi['config']['get']>
  let locationReload: Mock<OpenCodeApi['location']['reload']>
  let mcpList: Mock<OpenCodeApi['mcp']['list']>

  function configPath(name: string): string {
    return path.join(ws.workspacePath, '.config/opencode', name)
  }

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  function jsonHeaders() {
    return { 'content-type': 'application/json', ...authHeaders() }
  }

  function useConfigEntries(entries: ConfigEntry[]): void {
    configGet.mockImplementation(async () => entries)
  }

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDatabase()
    configGet = vi.fn<OpenCodeApi['config']['get']>(async () => [])
    locationReload = vi.fn<OpenCodeApi['location']['reload']>(async () => undefined)
    mcpList = vi.fn<OpenCodeApi['mcp']['list']>(async () => ({
      location: { directory: ws.workspacePath },
      data: [],
    }))
    const openCodeClient = createStubOpenCodeClient({
      api: {
        config: { get: configGet },
        location: { reload: locationReload },
        mcp: { list: mcpList },
      },
    })
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route(
      '/api/internal',
      createInternalTestApp(db, { settingsService: new SettingsService(db), openCodeClient }),
    )
  })

  afterEach(async () => {
    await ws.cleanup()
    db.close()
  })

  it('GET /api/internal/opencode-config returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-config')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-config returns 404 when no config file exists', async () => {
    const res = await app.request('/api/internal/opencode-config', { headers: authHeaders() })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(404)
    expect(body.error).toBe('No OpenCode config file found')
  })

  it('GET /api/internal/opencode-config returns the merged snapshot with secrets redacted and no raw source', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        providers: { example: { settings: { apiKey: 'secret-key' } } },
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
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.path).toBe(configPath('opencode.jsonc'))
    expect(body.rawContent).toBeUndefined()
    expect(body.sources[0]?.rawContent).toBeUndefined()
    expect(body.content).toEqual({
      $schema: 'https://opencode.ai/config.json',
      providers: { example: { settings: { apiKey: '<redacted>' } } },
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
      'providers.example.settings.apiKey',
    ])
  })

  it('PATCH /api/internal/opencode-config merges only the named paths and reloads the server', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark', small_model: 's' }), 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({
        patch: { mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } } },
      }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.content).toEqual({
      theme: 'dark',
      small_model: 's',
      mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } },
    })
    expect(body.rawContent).toBeUndefined()
    expect(locationReload).toHaveBeenCalledTimes(1)
    const onDisk = JSON.parse(await readFile(configPath('opencode.jsonc'), 'utf8'))
    expect(JsonObjectSchema.parse(onDisk)).toEqual(body.content)
  })

  it('PATCH /api/internal/opencode-config returns a redacted body without raw source', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({ theme: 'dark', provider: { example: { apiKey: 'secret-key' } } }),
      'opencode.jsonc',
    )

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ patch: { provider: { example: { apiKey: 'updated-secret' } } } }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.rawContent).toBeUndefined()
    expect(body.sources[0]?.rawContent).toBeUndefined()
    expect(body.content).toEqual({
      theme: 'dark',
      provider: { example: { apiKey: '<redacted>' } },
    })
    expect(body.redactedPaths).toEqual(['provider.example.apiKey'])
  })

  it.each([
    {
      label: 'a patch',
      method: 'PATCH',
      requestBody: { patch: { provider: { example: { apiKey: '<redacted>' } } } },
    },
    {
      label: 'raw content',
      method: 'PUT',
      requestBody: {
        content: '{\n  // keep\n  "provider": { "example": { "apiKey": "<redacted>" } }\n}\n',
        source: 'opencode.jsonc',
      },
    },
  ])('rejects a redacted placeholder in $label without writing', async ({ method, requestBody }) => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark' }), 'opencode.jsonc')
    const before = await readFile(configPath('opencode.jsonc'), 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method,
      headers: jsonHeaders(),
      body: JSON.stringify(requestBody),
    })
    const body = await readJson(res, PathsErrorSchema)

    expect(res.status).toBe(400)
    expect(body.paths).toEqual(['provider.example.apiKey'])
    expect(body.error).toContain('redacted placeholder')
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(before)
  })

  it('PATCH /api/internal/opencode-config reloads for a non-mcp change', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ theme: 'dark' }), 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ patch: { theme: 'light' } }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.content).toEqual({ theme: 'light' })
    expect(locationReload).toHaveBeenCalledTimes(1)
  })

  it.each([{ method: 'PATCH' }, { method: 'PUT' }])(
    '$method /api/internal/opencode-config returns 409 for a stale expectedRevision',
    async ({ method }) => {
      const initial = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
      await writeFile(configPath('opencode.json'), '{"model":"a/b"}', 'utf8')
      const requestBody = method === 'PATCH'
        ? { patch: { theme: 'light' }, expectedRevision: initial.revision }
        : { content: { theme: 'light' }, expectedRevision: initial.revision }

      const res = await app.request('/api/internal/opencode-config', {
        method,
        headers: jsonHeaders(),
        body: JSON.stringify(requestBody),
      })
      const body = await readJson(res, RevisionConflictSchema)

      expect(res.status).toBe(409)
      expect(body.expectedRevision).toBe(initial.revision)
      expect(body.actualRevision).not.toBe(initial.revision)
    },
  )

  it('GET /api/internal/opencode-config/mcp lists managed servers with live status and no shape', async () => {
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
        },
      }),
      'opencode.jsonc',
    )
    useConfigEntries([{
      type: 'document',
      path: configPath('opencode.jsonc'),
      info: {
        mcp: {
          servers: {
            linear: { type: 'remote', url: 'https://linear.example.com' },
            local: { type: 'local', command: ['npx', 'local'], disabled: true },
          },
        },
      },
    }])
    mcpList.mockResolvedValue({
      location: { directory: ws.workspacePath },
      data: [
        { name: 'linear', status: { status: 'connected' } },
        { name: 'local', status: { status: 'disabled' } },
      ],
    })

    const res = await app.request('/api/internal/opencode-config/mcp', { headers: authHeaders() })
    const body = await readJson(res, McpServersSchema)

    expect(res.status).toBe(200)
    expect(body.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(body.servers).toEqual([
      { name: 'linear', type: 'remote', url: 'https://linear.example.com', enabled: true, status: 'connected' },
      { name: 'local', type: 'local', command: ['npx', 'local'], enabled: false, status: 'disabled' },
    ])
    expect(mcpList).toHaveBeenCalledWith({ location: { directory: ws.workspacePath } })
  })

  it('GET /api/internal/opencode-config/mcp returns managed servers when the status list is unreachable', async () => {
    await writeOpenCodeConfigFile(
      JSON.stringify({ mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } } }),
      'opencode.jsonc',
    )
    useConfigEntries([{
      type: 'document',
      path: configPath('opencode.jsonc'),
      info: { mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } } },
    }])
    mcpList.mockRejectedValue(new Error('unreachable'))

    const res = await app.request('/api/internal/opencode-config/mcp', { headers: authHeaders() })
    const body = await readJson(res, McpServersSchema)

    expect(res.status).toBe(200)
    expect(body.servers).toEqual([
      { name: 'local', type: 'local', command: ['npx', 'local'], enabled: true },
    ])
  })

  it.each(['/opencode-config/mcp', '/opencode-config/managed'])(
    'GET %s returns 503 when OpenCode is unreachable',
    async (endpoint) => {
      configGet.mockImplementation(async () => {
        throw new ClientError('Transport')
      })

      const res = await app.request(`/api/internal${endpoint}`, { headers: authHeaders() })
      const body = await readJson(res, ErrorResponseSchema)

      expect(res.status).toBe(503)
      expect(body.error).toBe('OpenCode server unavailable')
    },
  )

  it('PUT /api/internal/opencode-config writes the file and applies it through a location reload without a restart', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ content: { $schema: 'https://opencode.ai/config.json', plugin: ['x'] } }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.restartRequired).toBeUndefined()
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json', plugin: ['x'] })
    expect(locationReload).toHaveBeenCalledTimes(1)
    expect(configGet).not.toHaveBeenCalled()

    const onDisk = JsonObjectSchema.parse(JSON.parse(await readFile(configPath('opencode.jsonc'), 'utf8')))
    expect(onDisk.plugin).toEqual(['x'])
  })

  it('PUT /api/internal/opencode-config does not report restartRequired for a comment-only edit', async () => {
    await writeOpenCodeConfigFile('{"theme":"dark"}', 'opencode.json')
    const commented = '{\n  // keep this comment\n  "theme": "dark"\n}\n'

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ content: commented, source: 'opencode.json' }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.restartRequired).toBeUndefined()
    expect(locationReload).not.toHaveBeenCalled()
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(commented)
  })

  it('PUT /api/internal/opencode-config forwards the requested source', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const submitted = '{\n  "theme": "light"\n}\n'

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: { $schema: 'https://opencode.ai/config.json', provider: { example: { apiKey: 'secret-key' } } },
      }),
    })
    const body = await readJson(res, ConfigFileSchema)

    expect(res.status).toBe(200)
    expect(body.rawContent).toBeUndefined()
    expect(body.sources[0]?.rawContent).toBeUndefined()
    expect(body.content).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: { example: { apiKey: '<redacted>' } },
    })
    expect(body.redactedPaths).toEqual(['provider.example.apiKey'])
  })

  it('PUT /api/internal/opencode-config returns 409 for a shadowed removal', async () => {
    const lower = '{"theme":"light","model":"test/a"}'
    const target = '{"model":"test/b"}'
    await writeOpenCodeConfigFile(target, 'opencode.jsonc')
    await writeFile(configPath('opencode.json'), lower, 'utf8')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ content: { model: 'test/b' } }),
    })
    const body = await readJson(res, ShadowedRemovalSchema)

    expect(res.status).toBe(409)
    expect(body.paths).toEqual(['theme'])
    expect(body.sources).toEqual(['opencode.json'])
    expect(body.error).toContain('Cannot remove theme')
    await expect(readFile(configPath('opencode.json'), 'utf8')).resolves.toBe(lower)
    await expect(readFile(configPath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
  })

  it.each([
    { label: 'schema-invalid content', content: { model: 5 } },
    { label: 'invalid raw content', content: '{"model": 5}' },
  ])('PUT /api/internal/opencode-config returns 400 with validationIssues for $label', async ({ content }) => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ content }),
    })
    const body = await readJson(res, ValidationErrorSchema)

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid config data')
    expect(body.validationIssues.map((issue) => issue.path)).toEqual(['model'])
  })

  it('PUT /api/internal/opencode-config returns 400 for an invalid JSON body', async () => {
    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: '{',
    })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON')
  })

  it('GET /api/internal/opencode-config/effective redacts document config entries without writing them back', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.jsonc')
    const directoryPath = path.join(ws.workspacePath, '.config', 'opencode')
    useConfigEntries([
      {
        type: 'document',
        path: configPath('opencode.jsonc'),
        info: { shell: 'zsh', providers: { example: { settings: { apiKey: 'secret-key' } } } },
      },
      { type: 'directory', path: directoryPath },
    ])

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })
    const body = await readJson(res, EffectiveConfigSchema)

    expect(res.status).toBe(200)
    expect(body.entries).toEqual([
      {
        type: 'document',
        path: configPath('opencode.jsonc'),
        info: { shell: 'zsh', providers: { example: { settings: { apiKey: '<redacted>' } } } },
      },
      { type: 'directory', path: directoryPath },
    ])
    expect(configGet).toHaveBeenCalledWith({ location: { directory: ws.workspacePath } })
    const persisted = await readOpenCodeConfigFile()
    expect(persisted?.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
  })

  it('GET /api/internal/opencode-config/effective returns 502 when the server rejects the request', async () => {
    configGet.mockImplementation(async () => {
      throw new ClientError('UnexpectedStatus')
    })

    const res = await app.request('/api/internal/opencode-config/effective', { headers: authHeaders() })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(502)
    expect(body.error).toBe('Failed to get effective OpenCode config')
  })

  it('GET /api/internal/opencode-config/managed merges only Manager source documents and redacts secrets', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ shell: 'bash' }), 'opencode.json')
    await writeOpenCodeConfigFile(JSON.stringify({ shell: 'zsh' }), 'opencode.jsonc')
    const unmanagedPath = path.join(ws.workspacePath, 'unmanaged', 'opencode.json')
    useConfigEntries([
      {
        type: 'document',
        path: configPath('opencode.json'),
        info: { shell: 'bash', providers: { example: { settings: { apiKey: 'secret-key' } } } },
      },
      {
        type: 'document',
        path: configPath('opencode.jsonc'),
        info: {
          shell: 'zsh',
          mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } },
        },
      },
      {
        type: 'document',
        path: unmanagedPath,
        info: { shell: 'ignored' },
      },
      { type: 'directory', path: path.join(ws.workspacePath, '.config', 'opencode') },
    ])

    const res = await app.request('/api/internal/opencode-config/managed', { headers: authHeaders() })
    const body = await readJson(res, ManagedConfigSchema)

    expect(res.status).toBe(200)
    expect(body.info).toEqual({
      shell: 'zsh',
      providers: { example: { settings: { apiKey: '<redacted>' } } },
      mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } },
    })
    expect(configGet).toHaveBeenCalledWith({ location: { directory: ws.workspacePath } })
  })

  it('GET /api/internal/opencode-config/managed reports a v1-only file through the converted entries the client returns', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED, 'opencode.json')
    await writeFile(configPath('opencode.json'), JSON.stringify({
      agent: { reviewer: { mode: 'subagent' } },
    }), 'utf8')
    useConfigEntries([{
      type: 'document',
      path: configPath('opencode.json'),
      info: { agents: { reviewer: { mode: 'subagent' } } },
    }])

    const res = await app.request('/api/internal/opencode-config/managed', { headers: authHeaders() })
    const body = await readJson(res, ManagedConfigSchema)

    expect(res.status).toBe(200)
    expect(body.info).toEqual({ agents: { reviewer: { mode: 'subagent' } } })
    const persisted = JsonObjectSchema.parse(JSON.parse(await readFile(configPath('opencode.json'), 'utf8')))
    expect(persisted.agent).toEqual({ reviewer: { mode: 'subagent' } })
    expect((await readOpenCodeConfigFile())?.path).toBe(configPath('opencode.json'))
  })
})
