import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const serveMock = vi.fn()

vi.mock('@hono/node-server', () => ({
  serve: serveMock,
}))

const supervisorMock = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue({ healthy: true, port: 5551, state: 'running' }),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue({ healthy: true }),
  getLastStartupError: vi.fn().mockReturnValue(null),
}))

vi.mock('../src/services/opencode-supervisor', () => ({
  OpenCodeSupervisor: vi.fn().mockImplementation(() => supervisorMock),
}))

const scheduleRunnerMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../src/services/schedules', () => ({
  ScheduleService: vi.fn().mockImplementation(() => ({
    getActiveRunSessions: vi.fn().mockResolvedValue([]),
  })),
  ScheduleRunner: vi.fn().mockImplementation(() => scheduleRunnerMock),
}))

vi.mock('../src/services/sandbox/runtime', () => ({
  SandboxRuntimeService: vi.fn().mockImplementation(() => ({
    prepareWorkspaceSandboxOnBoot: vi.fn().mockResolvedValue(undefined),
  })),
  stopWorkspaceSandboxOnShutdown: vi.fn().mockResolvedValue(undefined),
}))

const ipcServerMock = vi.hoisted(() => ({
  ipcHandlePath: '/tmp/opencode-test-ipc.sock',
  dispose: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/ipc/ipcServer', () => ({
  createIPCServer: vi.fn().mockResolvedValue(ipcServerMock),
}))

vi.mock('../src/services/opencode-import', () => ({
  getOpenCodeImportStatus: vi.fn().mockResolvedValue({
    configSourcePath: null,
    configSourcePaths: [],
    stateSourcePath: null,
    workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
    workspaceConfigPathsToRemove: [],
    workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
    workspaceStateExists: true,
  }),
  syncOpenCodeImport: vi.fn().mockResolvedValue({ configImported: false, stateImported: false }),
}))

vi.mock('../src/services/assistant-mode', () => ({
  installAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
}))

const seedOpenCodeConfigFileMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  path: '',
  rawContent: '',
  content: {},
  isValid: true,
  updatedAt: 0,
  sources: [],
  revision: '',
}))

vi.mock('../src/services/opencode-config-apply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/opencode-config-apply')>()),
  seedOpenCodeConfigFile: seedOpenCodeConfigFileMock,
}))

vi.mock('../src/services/skills', () => ({
  migrateGlobalSkills: vi.fn().mockResolvedValue(undefined),
}))

const sseAggregatorMock = vi.hoisted(() => ({
  onEvent: vi.fn(),
  setPendingActionsFetcher: vi.fn(),
  setPasswordResolver: vi.fn(),
  setScheduledSessionsResolver: vi.fn(),
  start: vi.fn(),
  shutdown: vi.fn(),
  reconnect: vi.fn(),
}))

vi.mock('../src/services/sse-aggregator', () => ({
  sseAggregator: sseAggregatorMock,
}))

const serverManagerMock = vi.hoisted(() => ({
  getVersion: vi.fn().mockReturnValue('1.2.27'),
  fetchVersion: vi.fn().mockResolvedValue('1.2.27'),
  setDatabase: vi.fn(),
  start: vi.fn().mockResolvedValue({ healthy: true, port: 5551, state: 'running' }),
  stop: vi.fn().mockResolvedValue(undefined),
  getEffectiveServerHost: vi.fn().mockReturnValue('127.0.0.1'),
  getLastStartupError: vi.fn().mockReturnValue(null),
  clearStartupError: vi.fn(),
  markRestartPending: vi.fn(),
  isRestartPending: vi.fn().mockReturnValue(false),
  restart: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue(true),
}))

vi.mock('../src/services/opencode-single-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/opencode-single-server')>()
  return {
    ...actual,
    opencodeServerManager: serverManagerMock,
  }
})

vi.mock('../src/services/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getGitEnvironment: vi.fn().mockReturnValue({}),
  })),
}))

vi.mock('../src/services/schedule-worktree', () => ({
  ScheduleWorktreeManager: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('../src/services/credential-provider', () => ({
  CredentialProvider: vi.fn().mockImplementation(() => ({})),
}))

describe('backend entrypoint', () => {
  let tempWorkspace: string
  let previousWorkspace: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    tempWorkspace = await mkdtemp(join(tmpdir(), 'ocm-entrypoint-'))
    previousWorkspace = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = tempWorkspace
  })

  afterEach(async () => {
    const { sseAggregator } = await import('../src/services/sse-aggregator')
    sseAggregator.shutdown()
    if (previousWorkspace === undefined) {
      delete process.env.WORKSPACE_PATH
    } else {
      process.env.WORKSPACE_PATH = previousWorkspace
    }
    await rm(tempWorkspace, { recursive: true, force: true })
  })

  it('initializes the workspace, registers every route group, and serves the app', async () => {
    await import('../src/index')

    expect(serveMock).toHaveBeenCalledTimes(1)
    const options = serveMock.mock.calls[0]![0] as { fetch: unknown; port: number; hostname: string }
    expect(typeof options.fetch).toBe('function')
    expect(options.port).toBe(3001)
    expect(options.hostname).toBeDefined()

    expect(serverManagerMock.setDatabase).toHaveBeenCalledTimes(1)
    expect(supervisorMock.start).toHaveBeenCalledTimes(1)
    expect(scheduleRunnerMock.start).toHaveBeenCalledTimes(1)
    expect(sseAggregatorMock.start).toHaveBeenCalledTimes(1)
    expect(ipcServerMock.dispose).not.toHaveBeenCalled()
  })

  it('imports home state without rewriting an existing valid config', async () => {
    const configDir = join(tempWorkspace, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{"$schema":"https://opencode.ai/config.json"}')

    const { getOpenCodeImportStatus, syncOpenCodeImport } = await import('../src/services/opencode-import')
    vi.mocked(getOpenCodeImportStatus).mockResolvedValueOnce({
      configSourcePath: '/import/opencode.json',
      configSourcePaths: ['/import/opencode.json'],
      stateSourcePath: '/import/state',
      workspaceConfigPath: join(configDir, 'opencode.json'),
      workspaceConfigPathsToRemove: [],
      workspaceStatePath: join(tempWorkspace, '.opencode', 'state', 'opencode'),
      workspaceStateExists: false,
    })
    vi.mocked(syncOpenCodeImport).mockResolvedValueOnce({
      configSourcePath: '/import/opencode.json',
      configSourcePaths: ['/import/opencode.json'],
      stateSourcePath: '/import/state',
      workspaceConfigPath: join(configDir, 'opencode.json'),
      workspaceConfigPathsToRemove: [],
      workspaceStatePath: join(tempWorkspace, '.opencode', 'state', 'opencode'),
      workspaceStateExists: false,
      configImported: false,
      stateImported: true,
    })

    await import('../src/index')

    expect(syncOpenCodeImport).toHaveBeenCalledWith(expect.objectContaining({
      overwriteState: false,
      importConfig: false,
    }))
  })

  it('seeds the default config when no workspace or importable host config exists', async () => {
    await import('../src/index')

    expect(seedOpenCodeConfigFileMock).toHaveBeenCalledTimes(1)
  })

  it('answers the root route with service metadata outside production', async () => {
    await import('../src/index')

    const options = serveMock.mock.calls[0]![0] as { fetch: (request: Request) => Promise<Response> }
    const response = await options.fetch(new Request('http://localhost/'))
    const body = await response.json() as { name: string; status: string; endpoints: Record<string, string> }

    expect(response.status).toBe(200)
    expect(body.name).toBe('OpenCode WebUI')
    expect(body.status).toBe('running')
    expect(body.endpoints.repos).toBe('/api/repos')
  })

  it.each(['opencode.jsonc', 'opencode.json'])('preserves an existing %s without seeding', async (name) => {
    const configDir = join(tempWorkspace, '.config', 'opencode')
    const rawContent = '{\n  // preserve this source\n  "model": "test/model"\n}\n'
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, name), rawContent)

    await import('../src/index')

    expect(await readFile(join(configDir, name), 'utf8')).toBe(rawContent)
    expect(seedOpenCodeConfigFileMock).not.toHaveBeenCalled()
  })

  it('promotes a legacy config.json to opencode.json on startup without seeding', async () => {
    const configDir = join(tempWorkspace, '.config', 'opencode')
    const rawContent = '{\n  // legacy source\n  "model": "test/model"\n}\n'
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.json'), rawContent)

    await import('../src/index')

    expect(seedOpenCodeConfigFileMock).not.toHaveBeenCalled()
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe(rawContent)
    await expect(readFile(join(configDir, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const archived = await readdir(join(tempWorkspace, '.config', 'opencode-configs-archive'))
    expect(archived).toHaveLength(1)
    expect(await readFile(join(tempWorkspace, '.config', 'opencode-configs-archive', archived[0]!), 'utf8')).toBe(rawContent)
  })

  it('folds legacy config.json keys into an existing opencode.json on startup', async () => {
    const configDir = join(tempWorkspace, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{\n  // target source\n  "theme": "dark"\n}\n')
    await writeFile(join(configDir, 'config.json'), '{"model":"test/model"}')

    await import('../src/index')

    expect(seedOpenCodeConfigFileMock).not.toHaveBeenCalled()
    const merged = await readFile(join(configDir, 'opencode.json'), 'utf8')
    expect(merged).toContain('// target source')
    expect(merged).toContain('"theme": "dark"')
    expect(merged).toContain('"model": "test/model"')
    await expect(readFile(join(configDir, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ignores unknown API routes through the not-found handler', async () => {
    await import('../src/index')

    const options = serveMock.mock.calls[0]![0] as { fetch: (request: Request) => Promise<Response> }
    const response = await options.fetch(new Request('http://localhost/unknown-route'))

    expect(response.status).toBe(404)
  })
})
