import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SettingsResponseSchema } from '@opencode-manager/shared/schemas'
import type { OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { createSettingsRoutes, type SettingsRouteDependencies } from './settings'
import { GitAuthService } from '../services/git-auth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { createTestDatabase } from '../../test/helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../../test/helpers/test-env'
import { createFetchStub, type FetchStub } from '../../test/helpers/fetch-stub'
import { readJson } from '../../test/helpers/read-json'
import { sseAggregator } from '../services/sse-aggregator'
import type { OpenCodeRestartTarget } from '../services/opencode-restart'

const DirectoryFileListSchema = z.array(
  z.object({ kind: z.string(), name: z.string(), relativePath: z.string() }),
)

const DirectoryFileInstallSchema = z.object({
  kind: z.string(),
  filesInstalled: z.array(z.string()),
  restartRequired: z.boolean(),
})

const DiscoveredModelsSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })

const ActiveSessionsSchema = z.object({
  count: z.number(),
  sessions: z.array(z.object({ sessionID: z.string(), directory: z.string() })),
})

function lifecycleStatus(): OpenCodeLifecycleStatus {
  return {
    state: 'healthy',
    healthy: true,
    port: 5551,
    version: '2.0.15',
    minVersion: '2.0.0',
    versionSupported: true,
    lastError: null,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: 0,
    watching: false,
    updatedAt: new Date(0).toISOString(),
  }
}

function createSettingsDeps(): SettingsRouteDependencies {
  return {
    openCodeManager: {
      getVersion: () => '2.0.15',
      fetchVersion: async () => '2.0.15',
      clearStartupError: () => undefined,
      getLastStartupError: () => null,
      markRestartPending: vi.fn(),
      isRestartPending: () => false,
      restart: async () => undefined,
      checkHealth: async () => true,
    },
    installOpenCodeVersion: async (version) => version,
    detectSandboxCapability: () => ({ available: false, reason: 'sandbox unavailable in tests' }),
    sandboxResourceLimitError: () => null,
    syncManagerGitIdentityConfig: async () => ({ identity: null, error: null }),
  }
}

function createTestApp(
  db: Database,
  deps: SettingsRouteDependencies,
  openCodeSupervisor?: OpenCodeRestartTarget,
): Hono {
  const app = new Hono()
  app.route('/settings', createSettingsRoutes(db, new GitAuthService(), createStubOpenCodeClient(), openCodeSupervisor, deps))
  return app
}

describe('settings routes — serverEnvVars', () => {
  let db: Database
  let app: Hono
  let workspace: TempWorkspace

  beforeEach(() => {
    workspace = createTempWorkspace('settings-routes-')
    db = createTestDatabase()
    app = createTestApp(db, createSettingsDeps())
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('GET / returns empty serverEnvVars by default', async () => {
    const res = await app.request('/settings')

    expect(res.status).toBe(200)
    expect((await readJson(res, SettingsResponseSchema)).preferences.serverEnvVars).toEqual([])
  })

  it('PATCH / persists serverEnvVars and returns on GET', async () => {
    const patchRes = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          serverEnvVars: [{
            key: 'MY_FLAG',
            value: '1',
          }],
        },
      }),
    })

    expect(patchRes.status).toBe(200)
    expect((await readJson(patchRes, SettingsResponseSchema)).preferences.serverEnvVars).toEqual([
      {
        key: 'MY_FLAG',
        value: '1',
      },
    ])

    const res = await app.request('/settings')

    expect((await readJson(res, SettingsResponseSchema)).preferences.serverEnvVars).toEqual([
      {
        key: 'MY_FLAG',
        value: '1',
      },
    ])
  })
})

describe('settings routes — OpenCode directory file upload', () => {
  let db: Database
  let app: Hono
  let workspace: TempWorkspace
  let deps: SettingsRouteDependencies
  let restart: ReturnType<typeof vi.fn<OpenCodeRestartTarget['restart']>>

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-command-upload-')
    db = createTestDatabase()
    deps = createSettingsDeps()
    restart = vi.fn<OpenCodeRestartTarget['restart']>(async () => lifecycleStatus())
    app = createTestApp(db, deps, { restart })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('installs uploaded command markdown files into the OpenCode commands directory', async () => {
    const formData = new FormData()
    formData.append('kind', 'commands')
    formData.append('fileManifest', JSON.stringify([
      { fieldName: 'file0', relativePath: 'commands/git/commit.md' },
      { fieldName: 'file1', relativePath: 'commands/.DS_Store' },
    ]))
    formData.append('file0', new File(['commit body'], 'commit.md', { type: 'text/markdown' }))

    const res = await app.request('/settings/opencode-directory-files/install', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, DirectoryFileInstallSchema)).toEqual({
      kind: 'commands',
      filesInstalled: ['git/commit.md'],
      restartRequired: true,
    })
    await expect(readFile(join(workspace.path, '.config/opencode/commands/git/commit.md'), 'utf8')).resolves.toBe('commit body')
    expect(restart).not.toHaveBeenCalled()
    expect(deps.openCodeManager.markRestartPending).toHaveBeenCalledTimes(1)
  })

  it('lists uploaded command and agent directory files', async () => {
    await mkdir(join(workspace.path, '.config/opencode/commands/git'), { recursive: true })
    await mkdir(join(workspace.path, '.config/opencode/agents/team'), { recursive: true })
    await writeFile(join(workspace.path, '.config/opencode/commands/git/commit.md'), 'commit body')
    await writeFile(join(workspace.path, '.config/opencode/commands/git/.DS_Store'), 'metadata')
    await writeFile(join(workspace.path, '.config/opencode/agents/team/planner.md'), 'planner body')

    const commandsRes = await app.request('/settings/opencode-directory-files?kind=commands')
    const agentsRes = await app.request('/settings/opencode-directory-files?kind=agents')

    expect(commandsRes.status).toBe(200)
    expect(agentsRes.status).toBe(200)
    expect(await readJson(commandsRes, DirectoryFileListSchema)).toEqual([
      { kind: 'commands', name: 'commit', relativePath: 'git/commit.md' },
    ])
    expect(await readJson(agentsRes, DirectoryFileListSchema)).toEqual([
      { kind: 'agents', name: 'planner', relativePath: 'team/planner.md' },
    ])
  })
})

describe('settings routes — opencode model discovery', () => {
  let db: Database
  let app: Hono
  let workspace: TempWorkspace
  let originalFetch: typeof globalThis.fetch
  let fetchStub: FetchStub

  beforeEach(() => {
    workspace = createTempWorkspace('settings-model-discovery-')
    db = createTestDatabase()
    app = createTestApp(db, createSettingsDeps())
    originalFetch = globalThis.fetch
    fetchStub = createFetchStub(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    globalThis.fetch = fetchStub
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    db.close()
    workspace.restore()
  })

  it('returns empty models when endpoint is unreachable', async () => {
    fetchStub.mockRejectedValue(new Error('connection refused'))

    const res = await app.request('/settings/opencode-discover-models?baseUrl=http://localhost:9999&refresh=true')

    expect(res.status).toBe(200)
    expect((await readJson(res, DiscoveredModelsSchema)).models).toEqual([])
  })
})

describe('settings routes — active session reporting', () => {
  let db: Database
  let workspace: TempWorkspace

  beforeEach(() => {
    workspace = createTempWorkspace('settings-active-sessions-')
    db = createTestDatabase()
  })

  afterEach(() => {
    db.close()
    workspace.restore()
    vi.restoreAllMocks()
  })

  function stubActiveSessions(active: Record<string, string[]>, subagents: string[] = [], scheduled: string[] = []): void {
    vi.spyOn(sseAggregator, 'getActiveSessions').mockReturnValue(active)
    vi.spyOn(sseAggregator, 'isSubagentSession').mockImplementation((id) => subagents.includes(id))
    vi.spyOn(sseAggregator, 'getScheduledSessionIds').mockReturnValue(new Set(scheduled))
  }

  it('GET /opencode-active-sessions returns active user sessions excluding subagent and scheduled sessions', async () => {
    stubActiveSessions({ '/a': ['s1', 'sub1', 'sched1'] }, ['sub1'], ['sched1'])
    const app = createTestApp(db, createSettingsDeps())

    const res = await app.request('/settings/opencode-active-sessions')

    expect(res.status).toBe(200)
    const body = await readJson(res, ActiveSessionsSchema)
    expect(body.count).toBe(1)
    expect(body.sessions).toEqual([{ sessionID: 's1', directory: '/a' }])
  })
})
