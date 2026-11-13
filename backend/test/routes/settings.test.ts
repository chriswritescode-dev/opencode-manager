import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { Database as SQLiteDatabase } from 'bun:sqlite'
import type { Database } from 'bun:sqlite'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import type { GitCredential } from '@opencode-manager/shared'
import { ClientError, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import { createSettingsRoutes, type SettingsRouteDependencies } from '../../src/routes/settings'
import { SettingsService } from '../../src/services/settings'
import { GitAuthService } from '../../src/services/git-auth'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { clearOpenCodeVersionCache } from '../../src/services/opencode-installer'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { createStubOpenCodeClient, type OpenCodeApiOverrides } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { applyTestEnv, createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'
import type { MockInstance } from 'vitest'

const ConfigFileSchema = z.object({
  path: z.string(),
  rawContent: z.string(),
  isValid: z.boolean(),
  content: z.record(z.string(), JsonValueSchema),
})
const ErrorSchema = z.object({ error: z.string(), details: JsonValueSchema.optional() })
const ErrorWithPathsSchema = z.object({
  error: z.string(),
  details: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
})
const ManagedConfigSchema = z.object({ info: z.record(z.string(), JsonValueSchema) })
const McpConfigSchema = z.object({
  revision: z.string(),
  servers: z.array(z.record(z.string(), JsonValueSchema)),
})
const SettingsSchema = z.object({
  preferences: z.record(z.string(), JsonValueSchema),
  updatedAt: z.number(),
  restartRequired: z.boolean().optional(),
})
const ImportStatusSchema = z.object({
  configSourcePath: z.string().nullable(),
  stateSourcePath: z.string().nullable(),
  workspaceConfigPath: z.string(),
  workspaceStatePath: z.string(),
  workspaceStateExists: z.boolean(),
})
const ImportResultSchema = ImportStatusSchema.extend({
  success: z.boolean().optional(),
  serverRestarted: z.boolean().optional(),
  configImported: z.boolean().optional(),
  stateImported: z.boolean().optional(),
  relinkedRepos: z.object({
    relinkedCount: z.number(),
    existingCount: z.number(),
    nonRepoPathCount: z.number(),
    duplicatePathCount: z.number(),
  }),
})
const VersionsSchema = z.object({
  versions: z.array(z.object({ version: z.string(), tag: z.string(), name: z.string(), publishedAt: z.string().nullable() })),
  currentVersion: z.string().nullable(),
})
const UpgradeResultSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  oldVersion: z.string().nullable().optional(),
  newVersion: z.string().nullable().optional(),
  upgraded: z.boolean().optional(),
  recovered: z.boolean().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
})
const DirectoryFilesSchema = z.array(z.object({ kind: z.string(), name: z.string(), relativePath: z.string() }))
const DirectoryFileSchema = z.object({
  kind: z.string(),
  name: z.string(),
  relativePath: z.string(),
  content: z.string().optional(),
  restartRequired: z.boolean().optional(),
  filesInstalled: z.array(z.string()).optional(),
})
const SkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  scope: z.string(),
  location: z.string(),
  repoId: z.number().optional(),
  restartRequired: z.boolean().optional(),
})
const SkillListSchema = z.array(SkillSchema)
const AuthStatusSchema = z.object({ isSet: z.boolean(), source: z.string() })
const TokenSchema = z.object({ token: z.string() })
const SessionsSchema = z.object({ count: z.number(), sessions: z.array(z.object({ sessionID: z.string(), directory: z.string() })) })
const ModelsDiscoverySchema = z.object({ models: z.array(z.string()), cached: z.boolean() })
const SshTestSchema = z.object({ success: z.boolean(), message: z.string() })
const RemoteHeadersSchema = z.object({ headers: z.array(z.record(z.string(), JsonValueSchema)), unreadable: z.boolean() })

type ConfigGetOutput = Awaited<ReturnType<OpenCodeApi['config']['get']>>
type McpListOutput = Awaited<ReturnType<OpenCodeApi['mcp']['list']>>

const REGISTRY_URL = 'https://registry.npmjs.org/@opencode/cli'

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return input
}

function jsonResponse(body: z.infer<typeof JsonValueSchema>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function registryResponse(versions: string[], publishedAt: Record<string, string> = {}): Response {
  const entries = versions.map((version) => [version, {}])
  return jsonResponse({ versions: Object.fromEntries(entries), time: publishedAt })
}

describe('Settings routes', () => {
  let workspace: TempWorkspace
  let home: string
  let restoreHome: () => void
  let db: Database
  let reload: ReturnType<typeof vi.fn>
  let restart: ReturnType<typeof vi.fn>
  let manager: SettingsRouteDependencies['openCodeManager'] & { isRestartPending: ReturnType<typeof vi.fn> }
  let installer: ReturnType<typeof vi.fn>
  let capability: ReturnType<typeof vi.fn>
  let resourceLimitError: ReturnType<typeof vi.fn>
  let syncIdentity: ReturnType<typeof vi.fn>
  let deps: SettingsRouteDependencies
  let fetchMock: MockInstance<typeof fetch>
  let settingsApp: ReturnType<typeof createSettingsRoutes>

  function configPath(...segments: string[]): string {
    return join(workspace.path, '.config', 'opencode', ...segments)
  }

  function writeConfig(name: string, content: string): Promise<void> {
    return mkdir(configPath(), { recursive: true }).then(() => writeFile(configPath(name), content))
  }

  function createApp(overrides: {
    api?: OpenCodeApiOverrides
    deps?: Partial<SettingsRouteDependencies>
    supervisor?: { restart: ReturnType<typeof vi.fn> }
  } = {}) {
    const client = createStubOpenCodeClient({
      api: {
        location: { reload },
        config: { get: vi.fn(async () => []) },
        ...overrides.api,
      },
    })
    return createSettingsRoutes(
      db,
      new GitAuthService(),
      client,
      overrides.supervisor ?? { restart },
      { ...deps, ...overrides.deps },
    )
  }

  function settings(): SettingsService {
    return new SettingsService(db)
  }

  beforeEach(async () => {
    workspace = createTempWorkspace('settings-routes-test-')
    home = await mkdtemp(join(tmpdir(), 'settings-home-'))
    restoreHome = applyTestEnv({ HOME: home, OPENCODE_SERVER_PASSWORD: undefined, OPENCODE_BIN: undefined })
    db = createTestDatabase()
    reload = vi.fn(async () => undefined)
    restart = vi.fn(async () => ({ healthy: true }))
    manager = {
      getVersion: vi.fn(() => '2.2.5'),
      fetchVersion: vi.fn(async () => '2.2.5'),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      markRestartPending: vi.fn(),
      isRestartPending: vi.fn(() => false),
      restart: vi.fn(async () => undefined),
      checkHealth: vi.fn(async () => true),
    }
    installer = vi.fn(async () => '/home/node/.opencode/bin/opencode')
    capability = vi.fn(() => ({ available: true, msbVersion: 'msb 1.0.0' }))
    resourceLimitError = vi.fn(() => null)
    syncIdentity = vi.fn(async () => ({ identity: null, error: null }))
    deps = {
      openCodeManager: manager,
      installOpenCodeVersion: installer,
      detectSandboxCapability: capability,
      sandboxResourceLimitError: resourceLimitError,
      syncManagerGitIdentityConfig: syncIdentity,
    }
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (requestUrl(input) === REGISTRY_URL) return registryResponse(['2.2.5'])
      return new Response(null, { status: 404 })
    })
    await writeConfig('opencode.json', '{}')
    clearOpenCodeVersionCache()
    settingsApp = createApp()
  })

  afterEach(async () => {
    forceProcessAttestation(null)
    vi.restoreAllMocks()
    db.close()
    restoreHome()
    workspace.restore()
    await rm(home, { recursive: true, force: true })
  })

  describe('OpenCode config routes', () => {
    it('returns the on-disk config state', async () => {
      await writeConfig('opencode.json', '{"theme":"dark"}')

      const res = await settingsApp.request('/opencode-config')

      expect(res.status).toBe(200)
      await expect(readJson(res, ConfigFileSchema)).resolves.toMatchObject({
        path: configPath('opencode.json'),
        rawContent: '{"theme":"dark"}',
        isValid: true,
        content: { theme: 'dark' },
      })
    })

    it('returns 404 when no config file exists', async () => {
      await rm(configPath('opencode.json'), { force: true })

      const res = await settingsApp.request('/opencode-config')

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'No OpenCode config file found' })
    })

    it('returns 404 from rollback when no last known good config exists', async () => {
      const res = await settingsApp.request('/opencode-rollback', { method: 'POST' })

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'No previous working config available for rollback' })
      expect(restart).not.toHaveBeenCalled()
    })

    it('merges the managed config from Manager source documents', async () => {
      await writeConfig('opencode.json', '{"theme":"light","model":"a/b"}')
      await writeConfig('opencode.jsonc', '{"theme":"dark"}')
      const documents: ConfigGetOutput = [
        { type: 'document', path: configPath('opencode.json'), info: { model: 'a/b' } },
        { type: 'document', path: configPath('opencode.jsonc'), info: { model: 'c/d' } },
        { type: 'document', path: join(workspace.path, 'unmanaged.json'), info: { model: 'ignored' } },
      ]
      const configGet = vi.fn(async () => documents)
      const app = createApp({ api: { config: { get: configGet } } })

      const res = await app.request('/opencode-config/managed')

      expect(res.status).toBe(200)
      await expect(readJson(res, ManagedConfigSchema)).resolves.toEqual({ info: { model: 'c/d' } })
      expect(configGet).toHaveBeenCalledWith({ location: { directory: workspace.path } })
    })

    it('returns 503 when OpenCode is unavailable for the managed config', async () => {
      await writeConfig('opencode.jsonc', '{}')
      const app = createApp({
        api: { config: { get: vi.fn(async (): Promise<ConfigGetOutput> => { throw new ClientError('Transport') }) } },
      })

      const res = await app.request('/opencode-config/managed')

      expect(res.status).toBe(503)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'OpenCode server unavailable' })
    })

    it('lists configured MCP servers with their live status and no shape field', async () => {
      await writeConfig('opencode.jsonc', '{"mcp":{"servers":{"local":{"type":"local","command":["npx","local"]}}}}')
      const documents: ConfigGetOutput = [
        {
          type: 'document',
          path: configPath('opencode.jsonc'),
          info: { mcp: { servers: { local: { type: 'local', command: ['npx', 'local'] } } } },
        },
      ]
      const servers: McpListOutput = {
        location: { directory: workspace.path },
        data: [{ name: 'local', status: { status: 'connected' } }],
      }
      const app = createApp({
        api: {
          config: { get: vi.fn(async () => documents) },
          mcp: { list: vi.fn(async () => servers) },
        },
      })

      const res = await app.request('/opencode-config/mcp')

      expect(res.status).toBe(200)
      const body = await readJson(res, McpConfigSchema)
      expect(body.servers).toEqual([
        { name: 'local', type: 'local', command: ['npx', 'local'], enabled: true, status: 'connected' },
      ])
      expect(body.servers.every((server) => !('shape' in server))).toBe(true)
    })

    it('writes a new config and reloads without a restart', async () => {
      await writeConfig('opencode.json', '{"theme":"light"}')

      const res = await settingsApp.request('/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"theme":"dark"}' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, ConfigFileSchema)).resolves.toMatchObject({ content: { theme: 'dark' } })
      await expect(readFile(configPath('opencode.json'), 'utf-8')).resolves.toBe('{"theme":"dark"}')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(restart).not.toHaveBeenCalled()
    })

    it.each([
      ['a schema-invalid body', JSON.stringify({ content: 123 }), 'Invalid config data'],
      ['malformed JSON', '{', 'Invalid JSON'],
      ['an empty body', undefined, 'Invalid JSON'],
    ])('returns 400 for %s', async (_label, body, expectedError) => {
      const res = await settingsApp.request('/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({ error: expectedError })
    })

    it('maps an unreachable OpenCode to 503 and an unexpected failure to 500 for entity saves', async () => {
      const unavailableApp = createApp({
        api: { config: { get: vi.fn(async (): Promise<ConfigGetOutput> => { throw new ClientError('Transport') }) } },
      })
      const brokenApp = createApp({
        api: { config: { get: vi.fn(async (): Promise<ConfigGetOutput> => { throw new Error('boom') }) } },
      })
      const patchBody = JSON.stringify({ patch: { agents: { reviewer: { description: 'new' } } } })

      const unavailable = await unavailableApp.request('/opencode-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: patchBody,
      })
      const broken = await brokenApp.request('/opencode-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: patchBody,
      })

      expect(unavailable.status).toBe(503)
      await expect(readJson(unavailable, ErrorSchema)).resolves.toEqual({ error: 'OpenCode server unavailable' })
      expect(broken.status).toBe(500)
      await expect(readJson(broken, ErrorSchema)).resolves.toMatchObject({ error: 'Failed to update OpenCode config' })
    })

    it('restores the last known good config and restarts the server', async () => {
      await writeConfig('opencode.json', '{"theme":"broken"}')
      settings().saveLastKnownGoodConfig('{"theme":"dark"}')

      const res = await settingsApp.request('/opencode-rollback', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({ success: z.boolean(), message: z.string() }))).resolves.toEqual({
        success: true,
        message: 'Server restarted with the previous working config',
      })
      await expect(readFile(configPath('opencode.json'), 'utf-8')).resolves.toBe('{"theme":"dark"}')
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('deletes the config and restarts with a fallback when the restore restart fails', async () => {
      await writeConfig('opencode.json', '{"theme":"broken"}')
      settings().saveLastKnownGoodConfig('{"theme":"dark"}')
      restart.mockRejectedValueOnce(new Error('restart failed'))

      const res = await settingsApp.request('/opencode-rollback', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({
        success: z.boolean(),
        message: z.string(),
        fallback: z.boolean(),
      }))).resolves.toMatchObject({ success: true, fallback: true })
      await expect(readFile(configPath('opencode.json'), 'utf-8')).rejects.toThrow()
      expect(restart).toHaveBeenCalledTimes(2)
    })

    it('reloads a patch that names no entities while a restart is pending, and blocks entity patches', async () => {
      await writeConfig('opencode.json', '{"theme":"light"}')
      settingsApp = createApp()
      manager.isRestartPending.mockReturnValue(true)

      const entityRes = await settingsApp.request('/opencode-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { agents: { reviewer: { description: 'stale' } } } }),
      })
      const plainRes = await settingsApp.request('/opencode-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { theme: 'dark' } }),
      })

      expect(entityRes.status).toBe(409)
      await expect(readJson(entityRes, ErrorSchema)).resolves.toMatchObject({
        error: 'OpenCode has not loaded the saved configuration yet. Restart OpenCode before editing entries.',
      })
      expect(plainRes.status).toBe(200)
      await expect(readJson(plainRes, ConfigFileSchema)).resolves.toMatchObject({ content: { theme: 'dark' } })
    })

    it('reports restartRequired when the config reload fails', async () => {
      await writeConfig('opencode.json', '{"theme":"light"}')
      reload.mockRejectedValue(new Error('OpenCode server unavailable'))

      const res = await settingsApp.request('/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"theme":"dark"}' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, ConfigFileSchema.extend({ restartRequired: z.boolean() }))).resolves.toMatchObject({
        content: { theme: 'dark' },
        restartRequired: true,
      })
    })
  })

  describe('OpenCode import routes', () => {
    async function seedHostData(options: { config?: boolean; state?: boolean } = {}): Promise<void> {
      if (options.config) {
        const hostConfigDir = join(home, '.config', 'opencode')
        await mkdir(hostConfigDir, { recursive: true })
        await writeFile(join(hostConfigDir, 'opencode.json'), '{"theme":"imported"}')
      }
      if (options.state) {
        const statePath = join(home, '.local', 'share', 'opencode')
        await mkdir(statePath, { recursive: true })
        const stateDb = new SQLiteDatabase(join(statePath, 'opencode.db'))
        stateDb.run('CREATE TABLE session (directory TEXT)')
        stateDb.run("INSERT INTO session (directory) VALUES ('/Users/test/project-a')")
        stateDb.close()
      }
    }

    it('reports importable host config and state', async () => {
      await seedHostData({ config: true, state: true })

      const res = await settingsApp.request('/opencode-import/status')

      expect(res.status).toBe(200)
      await expect(readJson(res, ImportStatusSchema)).resolves.toMatchObject({
        configSourcePath: join(home, '.config', 'opencode', 'opencode.json'),
        stateSourcePath: join(home, '.local', 'share', 'opencode'),
        workspaceConfigPath: configPath('opencode.json'),
        workspaceStatePath: join(workspace.path, '.opencode', 'state', 'opencode'),
        workspaceStateExists: false,
      })
    })

    it('imports host config and state into the workspace and restarts', async () => {
      await seedHostData({ config: true, state: true })

      const res = await settingsApp.request('/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, ImportResultSchema)
      expect(body).toMatchObject({
        success: true,
        serverRestarted: true,
        configImported: true,
        stateImported: true,
        relinkedRepos: { relinkedCount: 0, existingCount: 0, nonRepoPathCount: 1, duplicatePathCount: 0 },
      })
      await expect(readFile(configPath('opencode.json'), 'utf-8')).resolves.toBe('{"theme":"imported"}')
      await expect(readFile(join(workspace.path, '.opencode', 'state', 'opencode', 'opencode.db'))).resolves.toBeDefined()
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('imports only the config without touching workspace state', async () => {
      await seedHostData({ config: true })

      const res = await settingsApp.request('/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, ImportResultSchema)
      expect(body).toMatchObject({ success: true, configImported: true, stateImported: false })
      await expect(readFile(join(workspace.path, '.opencode', 'state', 'opencode', 'opencode.db'))).rejects.toThrow()
    })

    it('returns 404 when the host has no importable data', async () => {
      const res = await settingsApp.request('/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({ error: 'No importable OpenCode host data found' })
      expect(restart).not.toHaveBeenCalled()
    })

    it('returns 409 when importing host state would overwrite existing workspace state', async () => {
      await seedHostData({ state: true })
      await mkdir(join(workspace.path, '.opencode', 'state', 'opencode'), { recursive: true })
      const workspaceDb = createTestDatabase(join(workspace.path, '.opencode', 'state', 'opencode', 'opencode.db'))
      workspaceDb.close()

      const res = await settingsApp.request('/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(409)
      await expect(readJson(res, ErrorSchema.extend({ code: z.string(), detail: z.string() }))).resolves.toMatchObject({
        error: 'OpenCode host import was blocked to protect existing workspace state',
        code: 'OPENCODE_IMPORT_PROTECTED',
      })
      expect(restart).not.toHaveBeenCalled()
    })
  })

  describe('OpenCode version routes', () => {
    it('lists supported OpenCode 2 releases with the current version', async () => {
      fetchMock.mockImplementation(async () => registryResponse(
        ['1.18.32', '2.1.1', '2.2.5', '2.2.6', '2.2.5-beta.1', '3.0.0'],
        { '2.2.5': '2026-01-02T00:00:00Z', '2.2.6': '2026-01-03T00:00:00Z' },
      ))
      clearOpenCodeVersionCache()
      manager.getVersion = vi.fn(() => '2.2.5')
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-versions')

      expect(res.status).toBe(200)
      await expect(readJson(res, VersionsSchema)).resolves.toEqual({
        versions: [
          { version: '2.2.6', tag: 'v2.2.6', name: 'v2.2.6', publishedAt: '2026-01-03T00:00:00Z' },
          { version: '2.2.5', tag: 'v2.2.5', name: 'v2.2.5', publishedAt: '2026-01-02T00:00:00Z' },
        ],
        currentVersion: '2.2.5',
      })
      expect(fetchMock).toHaveBeenCalledWith(REGISTRY_URL)
    })

    it('serves repeated version requests from the installer cache', async () => {
      await settingsApp.request('/opencode-versions')
      await settingsApp.request('/opencode-versions')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns 500 when the registry request fails', async () => {
      fetchMock.mockImplementation(async () => new Response('unavailable', { status: 503 }))
      clearOpenCodeVersionCache()

      const res = await settingsApp.request('/opencode-versions')

      expect(res.status).toBe(500)
      const body = await readJson(res, ErrorSchema)
      expect(body.error).toBe('Failed to fetch versions')
      expect(String(body.details)).toContain('503')
    })

    it.each([
      ['an older installable version', '2.1.1', 'OpenCode upgraded from v2.1.1 to v2.2.5 and restarted'],
      ['an unsupported newer major', '3.0.0', 'OpenCode upgraded from v3.0.0 to v2.2.5 and restarted'],
    ])('upgrades from %s', async (_label, currentVersion, expectedMessage) => {
      manager.getVersion = vi.fn(() => currentVersion)
      manager.fetchVersion = vi.fn(async () => '2.2.5')
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({
        success: true,
        upgraded: true,
        oldVersion: currentVersion,
        newVersion: '2.2.5',
        message: expectedMessage,
      })
      expect(installer).toHaveBeenCalledWith('2.2.5')
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('does not install when the current version is already the latest', async () => {
      manager.getVersion = vi.fn(() => '2.2.5')
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({
        success: true,
        upgraded: false,
        message: 'OpenCode is already up to date',
      })
      expect(installer).not.toHaveBeenCalled()
      expect(restart).not.toHaveBeenCalled()
    })

    it('installs when the current version is unknown', async () => {
      manager.getVersion = vi.fn(() => null)
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({
        success: true,
        upgraded: true,
        oldVersion: null,
        newVersion: '2.2.5',
        message: 'OpenCode v2.2.5 installed and restarted',
      })
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('returns 500 without restarting when the registry lookup fails during upgrade', async () => {
      fetchMock.mockImplementation(async () => new Response('unavailable', { status: 503 }))
      clearOpenCodeVersionCache()

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(500)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({
        error: 'Failed to upgrade OpenCode',
        recovered: false,
      })
      expect(restart).not.toHaveBeenCalled()
    })

    it('installs a requested version and restarts', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      manager.fetchVersion = vi.fn(async () => '2.2.5')
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.2.5' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({
        success: true,
        oldVersion: '2.1.1',
        newVersion: '2.2.5',
        message: 'OpenCode changed from v2.1.1 to v2.2.5',
      })
      expect(installer).toHaveBeenCalledWith('2.2.5')
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('installs the bare version when the request carries a v prefix', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      manager.fetchVersion = vi.fn(async () => '2.2.5')
      settingsApp = createApp()

      await settingsApp.request('/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'v2.2.5' }),
      })

      expect(installer).toHaveBeenCalledWith('2.2.5')
    })

    it('reports failure when the installed version is not the requested one', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      manager.fetchVersion = vi.fn(async () => '2.1.1')
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.2.5' }),
      })

      expect(res.status).toBe(400)
      const body = await readJson(res, UpgradeResultSchema)
      expect(body.success).toBe(false)
      expect(String(body.details)).toContain('did not result in version 2.2.5')
      expect(body.newVersion).toBe('2.1.1')
    })

    it.each([
      ['an empty version', '', null],
      ['a missing version', undefined, null],
      ['a command injection attempt', '1.2.27; cat /etc/passwd; #', null],
      ['an invalid format', 'invalid', null],
      ['a prerelease', '2.2.5-beta.1', null],
      ['an OpenCode 1.x version', '1.18.32', 'OpenCode 1.18.32 is not supported; OpenCode Manager requires OpenCode >=2.2.5 <3.0.0'],
      ['a version below the supported range', '2.2.4', 'OpenCode 2.2.4 is not supported; OpenCode Manager requires OpenCode >=2.2.5 <3.0.0'],
      ['a version above the supported range', '3.0.0', 'OpenCode 3.0.0 is not supported; OpenCode Manager requires OpenCode >=2.2.5 <3.0.0'],
    ])('rejects %s before installing', async (_label, version, expectedError) => {
      const res = await settingsApp.request('/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(version === undefined ? {} : { version }),
      })

      expect(res.status).toBe(400)
      if (expectedError !== null) {
        await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({ error: expectedError })
      }
      expect(installer).not.toHaveBeenCalled()
    })

    it.each([
      ['swap started', new Error('download failed after the swap'), true],
      ['before the swap', new Error('download failed before the swap'), false],
    ])('recovers the server when the install fails %s', async (_label, failure, swapStarted) => {
      manager.getVersion = vi.fn(() => '2.1.1')
      settingsApp = createApp()
      const { OpenCodeInstallError } = await import('../../src/services/opencode-installer')
      installer.mockRejectedValueOnce(new OpenCodeInstallError(failure.message, swapStarted))

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      if (swapStarted) {
        expect(res.status).toBe(400)
        await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: true, upgraded: false })
        expect(restart).toHaveBeenCalledTimes(1)
      } else {
        expect(res.status).toBe(500)
        await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: false, upgraded: false })
        expect(restart).not.toHaveBeenCalled()
      }
    })

    it('returns 500 when the recovery restart fails', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      settingsApp = createApp()
      const { OpenCodeInstallError } = await import('../../src/services/opencode-installer')
      installer.mockRejectedValueOnce(new OpenCodeInstallError('download failed', true))
      restart.mockRejectedValue(new Error('Restart failed'))

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(500)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: false })
    })

    it('does not crash when the version probe throws during recovery', async () => {
      manager.getVersion = vi.fn()
        .mockReturnValueOnce('2.1.1')
        .mockImplementationOnce(() => { throw new Error('GetVersion failed') })
      settingsApp = createApp()
      const { OpenCodeInstallError } = await import('../../src/services/opencode-installer')
      installer.mockRejectedValueOnce(new OpenCodeInstallError('install failed', true))

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(400)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: true, oldVersion: '2.1.1' })
      expect(manager.clearStartupError).toHaveBeenCalled()
    })

    it('recovers when detecting the installed version fails after an upgrade', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      manager.fetchVersion = vi.fn(async () => { throw new Error('Fetch version failed') })
      settingsApp = createApp()

      const res = await settingsApp.request('/opencode-upgrade', { method: 'POST' })

      expect(res.status).toBe(400)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: true })
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it('recovers from a version install failure after the swap started', async () => {
      manager.getVersion = vi.fn(() => '2.1.1')
      manager.fetchVersion = vi.fn(async () => '2.1.1')
      settingsApp = createApp()
      const { OpenCodeInstallError } = await import('../../src/services/opencode-installer')
      installer.mockRejectedValueOnce(new OpenCodeInstallError('download failed', true))

      const res = await settingsApp.request('/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.2.5' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, UpgradeResultSchema)).resolves.toMatchObject({ recovered: true })
      expect(restart).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['/opencode-upgrade', undefined],
      ['/opencode-install-version', JSON.stringify({ version: '2.2.5' })],
    ])('refuses %s while OPENCODE_BIN manages the binary', async (path, body) => {
      process.env.OPENCODE_BIN = '/usr/local/bin/opencode'

      const res = await settingsApp.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      expect(res.status).toBe(409)
      await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({ error: expect.stringContaining('OPENCODE_BIN') })
      expect(installer).not.toHaveBeenCalled()
      expect(restart).not.toHaveBeenCalled()
    })
  })

  describe('POST /opencode-restart', () => {
    it('returns 500 with the startup failure reason when a supervisor restart is unhealthy', async () => {
      const supervisor = { restart: vi.fn(async () => ({ healthy: false })) }
      manager.getLastStartupError = vi.fn(() => 'OpenCode version 1.18.15 does not support sandboxed bash tool rewriting')
      settingsApp = createApp({ supervisor })

      const res = await settingsApp.request('/opencode-restart', { method: 'POST' })

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({
        error: 'Failed to restart OpenCode server',
        details: 'OpenCode version 1.18.15 does not support sandboxed bash tool rewriting',
      })
      expect(supervisor.restart).toHaveBeenCalledWith('settings_restart')
    })

    it('returns success when the supervisor restart is healthy', async () => {
      const supervisor = { restart: vi.fn(async () => ({ healthy: true })) }
      settingsApp = createApp({ supervisor })

      const res = await settingsApp.request('/opencode-restart', { method: 'POST' })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({ success: z.boolean(), message: z.string() }))).resolves.toEqual({
        success: true,
        message: 'OpenCode server restarted successfully',
      })
    })

    it('returns 500 when the manager restart fails without a supervisor', async () => {
      manager.getLastStartupError = vi.fn(() => 'server failed to become healthy')
      manager.restart = vi.fn(async () => undefined)
      manager.checkHealth = vi.fn(async () => false)
      settingsApp = createSettingsRoutes(db, new GitAuthService(), createStubOpenCodeClient(), undefined, deps)

      const res = await settingsApp.request('/opencode-restart', { method: 'POST' })

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Failed to restart OpenCode server',
        details: 'server failed to become healthy',
      })
    })
  })

  describe('PATCH / restart requirements', () => {
    it.each([
      ['enabling sandboxing', { sandbox: { enabled: false } }, { sandbox: { enabled: true } }, true],
      ['disabling sandboxing', { sandbox: { enabled: true } }, { sandbox: { enabled: false } }, true],
      ['an unchanged sandbox setting', { sandbox: { enabled: true } }, { sandbox: { enabled: true } }, false],
      ['sandbox git credentials', { sandbox: { enabled: true, gitCredentials: false } }, { sandbox: { enabled: true, gitCredentials: true } }, false],
      ['sandbox defaultForNewSessions', { sandbox: { enabled: true, defaultForNewSessions: true } }, { sandbox: { enabled: true, defaultForNewSessions: false } }, false],
      ['a patch without sandbox settings', { sandbox: { enabled: true } }, { theme: 'light' }, false],
      ['server environment variables', { serverEnvVars: [] }, { serverEnvVars: [{ key: 'FOO', value: 'bar' }] }, true],
    ])('reports restartRequired for %s', async (_label, current, patch, expectsRestart) => {
      settings().updateSettings(current)

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: patch }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, SettingsSchema)
      expect(body.restartRequired).toBe(expectsRestart ? true : undefined)
      expect(manager.markRestartPending).toHaveBeenCalledTimes(expectsRestart ? 1 : 0)
    })

    it('requires a restart when git credentials change', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'new-token' } satisfies GitCredential
      settings().updateSettings({ gitCredentials: [{ ...credential, token: 'old-token' }] })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SettingsSchema)).resolves.toMatchObject({ restartRequired: true })
    })

    it('does not require a restart when git credentials are resubmitted unchanged', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'same-token' } satisfies GitCredential
      settings().updateSettings({ gitCredentials: [credential] })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, SettingsSchema)
      expect(body.restartRequired).toBeUndefined()
      expect(manager.markRestartPending).not.toHaveBeenCalled()
    })

    it('syncs the git identity config without requiring a restart', async () => {
      settings().updateSettings({ gitIdentity: { name: 'Old', email: 'old@example.com' } })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentity: { name: 'New', email: 'new@example.com' } } }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, SettingsSchema)
      expect(body.restartRequired).toBeUndefined()
      expect(syncIdentity).toHaveBeenCalledTimes(1)
      expect(manager.markRestartPending).not.toHaveBeenCalled()
    })

    it('marks a restart pending when resetting disables sandboxing', async () => {
      settings().updateSettings({ sandbox: { enabled: true } })

      const res = await settingsApp.request('/', { method: 'DELETE' })

      expect(res.status).toBe(200)
      await expect(readJson(res, SettingsSchema)).resolves.toMatchObject({ restartRequired: true })
      expect(manager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not mark a restart pending when resetting an already-default sandbox preference', async () => {
      const res = await settingsApp.request('/', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await readJson(res, SettingsSchema)
      expect(body.restartRequired).toBeUndefined()
      expect(manager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('PATCH / validation', () => {
    it('rejects an activityWindowMinutes value that is not an option', async () => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { activityWindowMinutes: 45 } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toMatchObject({ error: 'Invalid settings data' })
      expect(settings().getSettings().preferences.activityWindowMinutes).toBe(30)
    })

    it('accepts an allowed activityWindowMinutes value', async () => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { activityWindowMinutes: 60 } }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SettingsSchema)).resolves.toMatchObject({
        preferences: { activityWindowMinutes: 60 },
      })
    })

    it.each(['not-an-email', 'two words@example.com', '<agent>@example.com'])('rejects the git identity email %s', async (email) => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentity: { name: 'Agent', email } } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({
        error: 'Invalid settings data',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['preferences', 'gitIdentity', 'email'], message: 'Invalid email address' }),
        ]),
      })
      expect(settings().getSettings().preferences.gitIdentity?.email).toBe('')
    })

    it.each(['', 'agent@example.com', 'root@localhost', 'root@box'])('accepts the git identity email %s', async (email) => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentity: { name: 'Agent', email } } }),
      })

      expect(res.status).toBe(200)
      expect(settings().getSettings().preferences.gitIdentity).toEqual({ name: 'Agent', email })
    })

    it('trims identity emails before saving', async () => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            gitIdentity: { name: 'Root', email: '  root@box  ' },
            gitIdentities: [{ id: 'work', name: 'Work', email: ' agent@example.com ' }],
          },
        }),
      })

      expect(res.status).toBe(200)
      const preferences = settings().getSettings().preferences
      expect(preferences.gitIdentity).toEqual({ name: 'Root', email: 'root@box' })
      expect(preferences.gitIdentities).toEqual([{ id: 'work', name: 'Work', email: 'agent@example.com' }])
    })

    it('rejects an invalid email in a saved identity profile', async () => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentities: [{ id: 'a', name: 'Alpha', email: 'bad' }] } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({
        error: 'Invalid settings data',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['preferences', 'gitIdentities', 0, 'email'], message: 'Invalid email address' }),
        ]),
      })
    })
  })

  describe('PATCH / sandbox guards', () => {
    it('rejects enabling sandboxing when the capability is unavailable', async () => {
      capability.mockReturnValue({
        available: false,
        reason: '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host',
      })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Cannot enable sandboxing: /dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host',
      })
      expect(settings().getSettings().preferences.sandbox?.enabled).toBe(false)
      expect(manager.markRestartPending).not.toHaveBeenCalled()
    })

    it('rejects enabling sandboxing when process identity attestation is unavailable', async () => {
      forceProcessAttestation(false)

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Cannot enable sandboxing: process identity attestation is unavailable on this platform (Linux /proc is required)',
      })
      expect(settings().getSettings().preferences.sandbox?.enabled).toBe(false)
    })

    it('enables sandboxing when capability and attestation are available', async () => {
      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })

      expect(res.status).toBe(200)
      expect(settings().getSettings().preferences.sandbox?.enabled).toBe(true)
      expect(manager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('allows disabling sandboxing even when capability and attestation are unavailable', async () => {
      capability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })
      forceProcessAttestation(false)
      settings().updateSettings({ sandbox: { enabled: true } })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: false } } }),
      })

      expect(res.status).toBe(200)
      expect(settings().getSettings().preferences.sandbox?.enabled).toBe(false)
      expect(manager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('rejects sandbox resources above the host limit', async () => {
      settings().updateSettings({ sandbox: { enabled: true } })
      resourceLimitError.mockReturnValue('Requested 8 CPUs exceeds the host limit of 4')

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true, cpus: 8, memoryMib: 4096 } } }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'Requested 8 CPUs exceeds the host limit of 4' })
      expect(resourceLimitError).toHaveBeenCalledWith(expect.objectContaining({ cpus: 8, memoryMib: 4096 }))
      expect(settings().getSettings().preferences.sandbox?.cpus).toBeUndefined()
    })

    it('accepts sandbox resources within the host limit', async () => {
      settings().updateSettings({ sandbox: { enabled: true } })

      const res = await settingsApp.request('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true, cpus: 4, memoryMib: 8192 } } }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SettingsSchema)).resolves.toMatchObject({
        preferences: { sandbox: { enabled: true, cpus: 4, memoryMib: 8192 } },
      })
    })
  })

  describe('OpenCode directory file routes', () => {
    async function seedDirectoryFile(kind: 'agents' | 'commands', relativePath: string, content: string): Promise<void> {
      await mkdir(configPath(kind), { recursive: true })
      await writeFile(configPath(kind, relativePath), content)
    }

    it('lists directory files by kind', async () => {
      await seedDirectoryFile('agents', 'assistant.md', '# Assistant')

      const res = await settingsApp.request('/opencode-directory-files?kind=agents')

      expect(res.status).toBe(200)
      await expect(readJson(res, DirectoryFilesSchema)).resolves.toEqual([
        { kind: 'agents', name: 'assistant', relativePath: 'assistant.md' },
      ])
    })

    it('returns 400 for an invalid directory file kind', async () => {
      const res = await settingsApp.request('/opencode-directory-files?kind=unknown')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({ error: 'Invalid file kind' })
    })

    it('returns a directory file and its content', async () => {
      await seedDirectoryFile('commands', 'review.md', 'Review the changes')

      const res = await settingsApp.request('/opencode-directory-files/content?kind=commands&relativePath=review.md')

      expect(res.status).toBe(200)
      await expect(readJson(res, DirectoryFileSchema)).resolves.toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        content: 'Review the changes',
      })
    })

    it('returns 404 when the directory file does not exist', async () => {
      const res = await settingsApp.request('/opencode-directory-files/content?kind=agents&relativePath=missing.md')

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'File not found' })
    })

    it('returns 400 when the content query is invalid', async () => {
      const res = await settingsApp.request('/opencode-directory-files/content?kind=agents')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({ error: 'Invalid request' })
    })

    it('updates a directory file and reloads OpenCode', async () => {
      await seedDirectoryFile('commands', 'review.md', 'Old')

      const res = await settingsApp.request('/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands', relativePath: 'review.md', content: 'Updated' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, DirectoryFileSchema)).resolves.toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        restartRequired: false,
      })
      await expect(readFile(configPath('commands', 'review.md'), 'utf-8')).resolves.toBe('Updated')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(restart).not.toHaveBeenCalled()
    })

    it('returns 400 when updating a directory file with an invalid body', async () => {
      const res = await settingsApp.request('/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({ error: 'Invalid request' })
    })

    it('deletes a directory file and reloads OpenCode', async () => {
      await seedDirectoryFile('agents', 'assistant.md', '# Assistant')

      const res = await settingsApp.request('/opencode-directory-files?kind=agents&relativePath=assistant.md', {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({
        kind: z.string(),
        relativePath: z.string(),
        restartRequired: z.boolean(),
      }))).resolves.toEqual({
        kind: 'agents',
        relativePath: 'assistant.md',
        restartRequired: false,
      })
      await expect(readFile(configPath('agents', 'assistant.md'), 'utf-8')).rejects.toThrow()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('rejects installing directory files without multipart form data', async () => {
      const res = await settingsApp.request('/opencode-directory-files/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'agents' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Unsupported content type. Use multipart/form-data',
      })
    })

    it('installs uploaded directory files and reloads OpenCode', async () => {
      const formData = new FormData()
      formData.set('kind', 'agents')
      formData.set('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'assistant.md' }]))
      formData.set('file0', new File(['# Assistant'], 'assistant.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/opencode-directory-files/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({
        kind: z.string(),
        filesInstalled: z.array(z.string()),
        restartRequired: z.boolean(),
      }))).resolves.toEqual({
        kind: 'agents',
        filesInstalled: ['assistant.md'],
        restartRequired: false,
      })
      await expect(readFile(configPath('agents', 'assistant.md'), 'utf-8')).resolves.toBe('# Assistant')
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('writes AGENTS.md and reloads OpenCode without restarting the server', async () => {
      const res = await settingsApp.request('/agents-md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Rules' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({ success: z.boolean(), restartRequired: z.boolean() }))).resolves.toEqual({
        success: true,
        restartRequired: false,
      })
      await expect(readFile(configPath('AGENTS.md'), 'utf-8')).resolves.toBe('# Rules')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(restart).not.toHaveBeenCalled()
    })
  })

  describe('Skill routes', () => {
    it('creates, lists, reads and deletes a global skill', async () => {
      const createRes = await settingsApp.request('/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'Body', scope: 'global' }),
      })

      expect(createRes.status).toBe(200)
      await expect(readJson(createRes, SkillSchema)).resolves.toMatchObject({
        name: 'review',
        description: 'Review changes',
        scope: 'global',
        restartRequired: false,
      })
      await expect(readFile(configPath('skills', 'review', 'SKILL.md'), 'utf-8')).resolves.toContain('name: review')

      const listRes = await settingsApp.request('/skills')
      await expect(readJson(listRes, SkillListSchema)).resolves.toEqual([
        expect.objectContaining({ name: 'review', description: 'Review changes', scope: 'global' }),
      ])

      const getRes = await settingsApp.request('/skills/review?scope=global')
      await expect(readJson(getRes, SkillSchema)).resolves.toMatchObject({ name: 'review', body: 'Body' })

      const deleteRes = await settingsApp.request('/skills/review?scope=global', { method: 'DELETE' })
      expect(deleteRes.status).toBe(200)
      await expect(readJson(deleteRes, z.object({ success: z.boolean(), restartRequired: z.boolean() }))).resolves.toEqual({
        success: true,
        restartRequired: false,
      })
      await expect(readFile(configPath('skills', 'review', 'SKILL.md'), 'utf-8')).rejects.toThrow()
      expect(reload).toHaveBeenCalledTimes(2)
    })

    it('updates a skill and reloads OpenCode', async () => {
      settingsApp = createApp()
      await settingsApp.request('/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'Body', scope: 'global' }),
      })

      const res = await settingsApp.request('/skills/review?scope=global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SkillSchema)).resolves.toMatchObject({ description: 'Updated', restartRequired: false })
      await expect(readFile(configPath('skills', 'review', 'SKILL.md'), 'utf-8')).resolves.toContain('description: Updated')
    })

    it('returns 409 when creating a skill that already exists', async () => {
      await settingsApp.request('/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'Body', scope: 'global' }),
      })

      const res = await settingsApp.request('/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Other', body: 'Body', scope: 'global' }),
      })

      expect(res.status).toBe(409)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Skill "review" already exists in global scope',
      })
    })

    it('returns 400 for an invalid skill scope', async () => {
      const res = await settingsApp.request('/skills/review?scope=invalid')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Invalid scope parameter. Must be "global" or "project"',
      })
    })

    it('returns 400 when a project skill is requested without a repoId', async () => {
      const res = await settingsApp.request('/skills/review?scope=project')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'repoId is required for project scope' })
    })

    it('returns 404 when the skill does not exist', async () => {
      const res = await settingsApp.request('/skills/missing?scope=global')

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Skill "missing" not found in global scope',
      })
    })

    it('marks a restart pending when reloading OpenCode after a skill change fails', async () => {
      await settingsApp.request('/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'Body', scope: 'global' }),
      })
      reload.mockRejectedValue(new Error('OpenCode server unavailable'))

      const res = await settingsApp.request('/skills/review?scope=global', { method: 'DELETE' })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({ success: z.boolean(), restartRequired: z.boolean() }))).resolves.toEqual({
        success: true,
        restartRequired: true,
      })
      expect(manager.markRestartPending).toHaveBeenCalledTimes(1)
      expect(restart).not.toHaveBeenCalled()
    })

    it('installs a skill from a GitHub tree and reloads OpenCode', async () => {
      fetchMock.mockImplementation(async (input) => {
        const url = requestUrl(input)
        if (url.startsWith('https://api.github.com/repos/example/skill/contents/')) {
          return jsonResponse([
            {
              name: 'SKILL.md',
              path: 'review/SKILL.md',
              type: 'file',
              download_url: 'https://raw.githubusercontent.com/example/skill/main/review/SKILL.md',
            },
          ])
        }
        if (url === 'https://raw.githubusercontent.com/example/skill/main/review/SKILL.md') {
          return new Response('---\nname: review\ndescription: Review\n---\nBody')
        }
        return new Response(null, { status: 404 })
      })

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill/tree/main/review', scope: 'global' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, z.object({
        skill: SkillSchema,
        filesInstalled: z.array(z.string()),
        overwritten: z.boolean(),
        sourceType: z.string(),
        restartRequired: z.boolean(),
      }))).resolves.toMatchObject({
        skill: { name: 'review' },
        filesInstalled: ['SKILL.md'],
        overwritten: false,
        restartRequired: false,
      })
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when installing a project skill without a repoId', async () => {
      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'project' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'repoId is required for project scope' })
    })

    it('returns 400 when installing a skill with an unsupported content type', async () => {
      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not a skill',
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({
        error: 'Unsupported content type. Use application/json or multipart/form-data',
      })
    })
  })

  describe('POST /test-ssh', () => {
    let binDir: string
    let privateKey: string
    let restorePath: () => void

    function fakeCommand(name: string, script: string): Promise<void> {
      return writeFile(join(binDir, name), script).then(() => chmod(join(binDir, name), 0o755))
    }

    beforeEach(async () => {
      binDir = join(workspace.path, 'bin')
      await mkdir(binDir, { recursive: true })
      const keyPath = join(home, 'id_test')
      const generated = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', keyPath, '-q'], { encoding: 'utf8' })
      if (generated.status !== 0) throw new Error(`ssh-keygen failed: ${generated.stderr}`)
      privateKey = await readFile(keyPath, 'utf-8')
      restorePath = applyTestEnv({ PATH: `${binDir}:${process.env.PATH ?? ''}` })
    })

    afterEach(() => {
      restorePath()
    })

    it('returns 400 when the SSH key is invalid', async () => {
      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: 'not-a-key' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, SshTestSchema)).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining('Invalid SSH key'),
      })
    })

    it('reports a successful SSH authentication', async () => {
      await fakeCommand('ssh', '#!/bin/sh\necho "You\'ve successfully authenticated"\nexit 255\n')

      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'git@example.com:2222', sshPrivateKey: privateKey }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SshTestSchema)).resolves.toEqual({
        success: true,
        message: 'Successfully connected to git@example.com:2222',
      })
    })

    it('reports a timeout when the SSH command is killed', async () => {
      await fakeCommand('ssh', '#!/bin/sh\nkill -9 $$\n')

      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: privateKey }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SshTestSchema)).resolves.toEqual({
        success: false,
        message: 'Connection timed out. This may indicate a network issue or an incorrect host.',
      })
    })

    it.each([
      ['Permission denied (publickey)', 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.'],
      ['Could not resolve hostname example.com', 'Could not resolve hostname. Please check that the host is correct and accessible.'],
      ['ssh: connect to host example.com port 22: Connection refused', 'Connection refused or timed out. The host may be down or not accepting SSH connections.'],
    ])('maps the SSH failure %s', async (output, expectedMessage) => {
      await fakeCommand('ssh', `#!/bin/sh\necho "${output}" >&2\nexit 255\n`)

      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: privateKey }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SshTestSchema)).resolves.toEqual({ success: false, message: expectedMessage })
    })

    it('uses sshpass and reports ambiguous output when a passphrase is provided', async () => {
      await fakeCommand('sshpass', `#!/bin/sh\nprintf '%s' "$SSHPASS" > "${join(home, 'sshpass-password')}"\necho "debug1: no matching host key" >&2\nexit 255\n`)

      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: privateKey, passphrase: 'secret' }),
      })

      expect(res.status).toBe(200)
      const body = await readJson(res, SshTestSchema)
      expect(body.success).toBe(false)
      expect(body.message).toContain('Authentication failed')
      await expect(readFile(join(home, 'sshpass-password'), 'utf-8')).resolves.toBe('secret')
    })

    it('returns 400 for an invalid test-ssh body', async () => {
      const res = await settingsApp.request('/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorWithPathsSchema)).resolves.toMatchObject({ error: 'Invalid request data' })
    })
  })

  describe('OpenCode server auth routes', () => {
    it('reports the configured password source', async () => {
      const res = await settingsApp.request('/opencode-server-auth')

      expect(res.status).toBe(200)
      await expect(readJson(res, AuthStatusSchema)).resolves.toEqual({ isSet: true, source: 'managed' })
    })

    it('clears the stored password and falls back to the managed source', async () => {
      settings().setOpenCodeServerPassword('custom-password')

      const res = await settingsApp.request('/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, AuthStatusSchema)).resolves.toEqual({ isSet: true, source: 'managed' })
    })

    it('stores a new password and reports the db source', async () => {
      const res = await settingsApp.request('/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'new-password' }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, AuthStatusSchema)).resolves.toEqual({ isSet: true, source: 'db' })
    })

    it('restores the previous password state when the restart fails', async () => {
      settings().setOpenCodeServerPassword('previous-password')
      restart.mockRejectedValueOnce(new Error('restart failed'))

      const res = await settingsApp.request('/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'new-password' }),
      })

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'Failed to update OpenCode server auth' })
      expect(settings().getOpenCodeServerPasswordSource()).toBe('db')
      expect(settings().getStoredOpenCodeServerPasswordState()?.value).toBeDefined()
      expect(restart).toHaveBeenCalledTimes(2)
    })
  })

  describe('Maintenance routes', () => {
    it('returns the manager token', async () => {
      const res = await settingsApp.request('/manager-token')

      expect(res.status).toBe(200)
      await expect(readJson(res, TokenSchema)).resolves.toEqual({ token: getOrCreateInternalToken(db) })
    })

    it('rotates the manager token and marks a restart pending', async () => {
      const previous = getOrCreateInternalToken(db)

      const res = await settingsApp.request('/manager-token/rotate', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await readJson(res, TokenSchema)
      expect(body.token).not.toBe(previous)
      expect(manager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('returns 500 when the manager token cannot be read', async () => {
      const closedDb = createTestDatabase()
      closedDb.close()
      const brokenApp = createSettingsRoutes(closedDb, new GitAuthService(), createStubOpenCodeClient(), { restart }, deps)

      const res = await brokenApp.request('/manager-token')

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'Failed to get manager token' })
    })

    it('does not mark a restart pending when token rotation fails', async () => {
      const closedDb = createTestDatabase()
      closedDb.close()
      const brokenApp = createSettingsRoutes(closedDb, new GitAuthService(), createStubOpenCodeClient(), { restart }, deps)

      const res = await brokenApp.request('/manager-token/rotate', { method: 'POST' })

      expect(res.status).toBe(500)
      expect(manager.markRestartPending).not.toHaveBeenCalled()
    })

    it('returns the active user sessions from the SSE aggregator', async () => {
      vi.spyOn(sseAggregator, 'getActiveSessions').mockReturnValue({ '/repo': ['session-1'] })

      const res = await settingsApp.request('/opencode-active-sessions')

      expect(res.status).toBe(200)
      await expect(readJson(res, SessionsSchema)).resolves.toEqual({
        count: 1,
        sessions: [{ sessionID: 'session-1', directory: '/repo' }],
      })
    })

    it('returns an empty session list when no session is active', async () => {
      const res = await settingsApp.request('/opencode-active-sessions')

      expect(res.status).toBe(200)
      await expect(readJson(res, SessionsSchema)).resolves.toEqual({ count: 0, sessions: [] })
    })

    it('validates the model discovery baseUrl', async () => {
      const missing = await settingsApp.request('/opencode-discover-models')
      const invalid = await settingsApp.request('/opencode-discover-models?baseUrl=not-a-url')
      const nonHttp = await settingsApp.request('/opencode-discover-models?baseUrl=ftp://example.com')

      expect(missing.status).toBe(400)
      await expect(readJson(missing, ErrorSchema)).resolves.toEqual({ error: 'baseUrl is required' })
      expect(invalid.status).toBe(400)
      await expect(readJson(invalid, ErrorSchema)).resolves.toEqual({ error: 'Invalid baseUrl' })
      expect(nonHttp.status).toBe(400)
      await expect(readJson(nonHttp, ErrorSchema)).resolves.toEqual({ error: 'baseUrl must be an http or https URL' })
    })

    it('discovers and caches models from an upstream provider', async () => {
      fetchMock.mockImplementation(async (input) => {
        const url = requestUrl(input)
        if (url === 'https://api.example.com/v1/models' || url === 'https://api.example.com/models') {
          return jsonResponse({ data: [{ id: 'gpt-4' }] })
        }
        return new Response(null, { status: 404 })
      })

      const first = await settingsApp.request('/opencode-discover-models?baseUrl=https://api.example.com&apiKey=secret&refresh=true')
      const second = await settingsApp.request('/opencode-discover-models?baseUrl=https://api.example.com&apiKey=secret')

      expect(first.status).toBe(200)
      await expect(readJson(first, ModelsDiscoverySchema)).resolves.toEqual({ models: ['gpt-4'], cached: false })
      await expect(readJson(second, ModelsDiscoverySchema)).resolves.toEqual({ models: ['gpt-4'], cached: true })
    })

    it('returns 500 when model discovery fails', async () => {
      await writeFile(join(workspace.path, 'cache'), 'not a directory')

      const res = await settingsApp.request('/opencode-discover-models?baseUrl=https://api.example.com')

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorSchema)).resolves.toEqual({ error: 'Failed to discover models' })
    })

    it('serves the remote access header summary', async () => {
      const res = await settingsApp.request('/remote-access-headers')

      expect(res.status).toBe(200)
      await expect(readJson(res, RemoteHeadersSchema)).resolves.toEqual({ headers: [], unreadable: false })
    })
  })
})
