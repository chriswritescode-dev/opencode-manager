import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

const createOpenCodeClientMock = vi.hoisted(() => vi.fn(() => ({
  forward: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  forwardRaw: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
  setProviderAuth: vi.fn(),
  deleteProviderAuth: vi.fn(),
})))

const spawnMock = vi.hoisted(() => vi.fn(() => ({
  pid: 1234,
  stderr: null,
  on: vi.fn(),
})))

const spawnSyncMock = vi.hoisted(() => vi.fn())

const readFileSyncMock = vi.hoisted(() => vi.fn())

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/test/workspace'),
  getOpenCodeConfigFilePath: vi.fn(() => '/test/workspace/.config/opencode.json'),
  getReposPath: vi.fn(() => '/test/workspace/repos'),
  getAgentsMdPath: vi.fn(() => '/test/workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/test/workspace/config'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/test/workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config', AUTH_FILE: 'auth.json' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1', SERVER_PASSWORD: '', SERVER_USERNAME: 'opencode', PUBLIC_URL: '' },
    TIMEOUTS: { HEALTH_CHECK_TIMEOUT_MS: 50 },
    DATABASE: { PATH: ':memory:' },
    SANDBOX: { MSB_PATH: 'msb' },
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

vi.mock('fs', () => ({
  accessSync: vi.fn(() => {
    const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  }),
  constants: { X_OK: 1, R_OK: 4, W_OK: 2, F_OK: 0 },
  readFileSync: readFileSyncMock,
  readdirSync: vi.fn(() => []),
  promises: {
    mkdir: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(() => Promise.resolve()),
    readdir: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}))

vi.mock('../../src/services/opencode/config-recovery', () => ({
  patchConfigWithRecovery: vi.fn(),
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: createOpenCodeClientMock,
}))

const installManagedPluginsMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/services/opencode/plugin-registry', () => ({
  installManagedPlugins: installManagedPluginsMock,
}))

const restoreQuarantinedOpenCodePluginsMock = vi.hoisted(() => vi.fn())
const getOpenCodePluginDiscoveryHomeMock = vi.hoisted(() => vi.fn(() => '/test/home'))

vi.mock('../../src/services/opencode-plugin-quarantine', () => ({
  restoreQuarantinedOpenCodePlugins: restoreQuarantinedOpenCodePluginsMock,
  getOpenCodePluginDiscoveryHome: getOpenCodePluginDiscoveryHomeMock,
}))

const sandboxRuntimeServiceMock = vi.hoisted(() => ({
  SandboxRuntimeService: vi.fn<() => {
    isEnabled: () => boolean
    stopWorkspaceSandboxForToggle?: () => Promise<void>
    prepareWorkspaceSandboxOnBoot?: () => Promise<void>
  }>(() => ({ isEnabled: () => false })),
}))

vi.mock('../../src/services/sandbox/runtime', () => ({
  SandboxRuntimeService: function SandboxRuntimeServiceStub() {
    return {
      prepareWorkspaceSandboxOnBoot: async () => undefined,
      ...sandboxRuntimeServiceMock.SandboxRuntimeService(),
    }
  },
}))

import { promises as fs, accessSync, readdirSync } from 'fs'
import { execSync, spawnSync } from 'child_process'
import path from 'path'
import os from 'os'
import { ConfigReloadError, resolveOpenCodeExecutable } from '../../src/services/opencode-single-server'
import { forceProcessAttestation, resetProcessIdentityProvider } from '../../src/services/opencode/process-identity'
import { encryptSecret } from '../../src/utils/crypto'
import { ENV } from '@opencode-manager/shared/config/env'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mkdirMock = fs.mkdir as any
const accessMock = fs.access as any
const readFileMock = fs.readFile as any
const execSyncMock = execSync as any
const childSpawnSyncMock = spawnSync as any
const readdirSyncMock = readdirSync as any

const routeVersionProbeThroughExecSyncStub = () => {
  childSpawnSyncMock.mockImplementation((file: string, args?: readonly string[]) => {
    if (Array.isArray(args) && args[0] === '--version') {
      return { status: 0, stdout: String(execSyncMock(`${file} --version`) ?? ''), stderr: '' }
    }
    return { status: 0, stdout: '', stderr: '' }
  })
}

beforeEach(routeVersionProbeThroughExecSyncStub)

// Reset singleton before any tests run to clear any polluted state from previous test files
beforeAll(async () => {
  const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
  OpenCodeServerManager.resetInstance()
})

describe('OpenCodeServerManager - server auth', () => {
  let originalHost: string
  let originalPassword: string

  beforeEach(async () => {
    vi.clearAllMocks()
    execSyncMock.mockReset()
    originalHost = ENV.OPENCODE.HOST
    originalPassword = ENV.OPENCODE.SERVER_PASSWORD
    setOpenCodeEnv({ host: '127.0.0.1', password: '' })
    readFileSyncMock.mockReturnValue(procStatString(1234, '42'))
    readdirSyncMock.mockReset()
    readdirSyncMock.mockReturnValue([])
    forceProcessAttestation(true)
    resetProcessIdentityProvider()
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    OpenCodeServerManager.resetInstance()
  })

  afterEach(async () => {
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    OpenCodeServerManager.resetInstance()
    vi.clearAllMocks()
  })

  const MSB_ENV_KEYS = [
    'MSB_HOME',
    'MSB_PATH',
    'MSB_LIBKRUNFW_PATH',
    'MSB_BACKEND',
    'MSB_PROFILE',
    'MSB_API_URL',
    'MSB_API_KEY',
  ]

  function snapshotMicrosandboxEnv(): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {}
    for (const key of MSB_ENV_KEYS) snapshot[key] = process.env[key]
    return snapshot
  }

  function clearMicrosandboxEnv(): void {
    for (const key of MSB_ENV_KEYS) delete process.env[key]
  }

  function restoreMicrosandboxEnv(snapshot: Record<string, string | undefined>): void {
    for (const key of MSB_ENV_KEYS) {
      if (snapshot[key] === undefined) delete process.env[key]
      else process.env[key] = snapshot[key]
    }
  }

  it('rebuilds the client with env password when no DB password is stored', async () => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')

    await opencodeServerManager.rebuildClient()

    expect(createOpenCodeClientMock).toHaveBeenCalledWith('envpassword123', '127.0.0.1')
  })

  it('rebuilds the client with DB password before env password', async () => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    opencodeServerManager.setDatabase(createPasswordDb('dbpassword123'))

    await opencodeServerManager.rebuildClient()

    expect(createOpenCodeClientMock).toHaveBeenCalledWith('dbpassword123', '127.0.0.1')
  })

  it('rebuilds the client against the configured host regardless of enforcement', async () => {
    setOpenCodeEnv({ host: '192.168.1.10', password: 'envpassword123' })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    ;(manager as unknown as { sandboxEnforced: boolean }).sandboxEnforced = true

    await manager.rebuildClient()

    expect(createOpenCodeClientMock).toHaveBeenCalledWith('envpassword123', '192.168.1.10')
  })

  it('rebuilds the client against the configured IPv6 host regardless of enforcement', async () => {
    setOpenCodeEnv({ host: '::1', password: 'envpassword123' })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    ;(manager as unknown as { sandboxEnforced: boolean }).sandboxEnforced = true

    await manager.rebuildClient()

    expect(createOpenCodeClientMock).toHaveBeenCalledWith('envpassword123', '::1')
  })

  it('fails startup when externally exposed without a resolved password', async () => {
    setOpenCodeEnv({ host: '0.0.0.0', password: '' })
    execSyncMock.mockReturnValue(Buffer.from('1234\n'))
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    opencodeServerManager.setDatabase(createPasswordDb(null))

    await expect(opencodeServerManager.start()).rejects.toThrow('no password is configured')

    expect(execSyncMock).not.toHaveBeenCalledWith('lsof -nP -t -iTCP:5551 -sTCP:LISTEN')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(opencodeServerManager.getLastStartupError()).toContain('OPENCODE_HOST=0.0.0.0')
  })

  it('starts when externally exposed with a resolved password', async () => {
    setOpenCodeEnv({ host: '0.0.0.0', password: 'envpassword123' })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')

    await OpenCodeServerManager.getInstance().start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--port', '5551', '--hostname', '0.0.0.0'],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCODE_SERVER_PASSWORD: 'envpassword123',
          OPENCODE_SERVER_USERNAME: 'opencode',
        }),
      })
    )
  })

  it('binds an enforced server to the configured host even when OPENCODE_HOST is externally bound', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    setOpenCodeEnv({ host: '0.0.0.0', password: 'envpassword123' })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb('envpassword123'))

    await manager.start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--port', '5551', '--hostname', '0.0.0.0'],
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'true',
          OPENCODE_SERVER_PASSWORD: 'envpassword123',
        }),
      })
    )
  })

  it('requires an OpenCode password for an enforced server bound to an external host', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    setOpenCodeEnv({ host: '0.0.0.0', password: '' })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('no password is configured')

    expect(spawnMock).not.toHaveBeenCalled()
    expect(manager.getLastStartupError()).toContain('OPENCODE_HOST=0.0.0.0')
  })

  it('stamps OCM_SANDBOX_ENFORCED=false into the spawned env by default', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    await OpenCodeServerManager.getInstance().start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'false',
        }),
      })
    )
  })

  it('stamps OCM_SANDBOX_ENFORCED=true when the sandbox runtime reports enforcement', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'true',
        }),
      })
    )
  })

  it('keeps OCM_SANDBOX_ENFORCED manager-controlled despite a user-supplied serverEnvVars entry', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [{ key: 'OCM_SANDBOX_ENFORCED', value: 'user-tampered' }],
    }))

    await manager.start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'false',
        }),
      })
    )
  })

  it('drops user-supplied MSB_* serverEnvVars so the child always runs the manager-owned microsandbox runtime', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const savedEnv = snapshotMicrosandboxEnv()
    try {
      clearMicrosandboxEnv()
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPreferencesDb({
        serverEnvVars: [
          { key: 'MSB_HOME', value: '/evil/msb-home' },
          { key: 'MSB_BACKEND', value: 'cloud' },
          { key: 'MSB_PATH', value: '/evil/msb' },
          { key: 'MSB_LIBKRUNFW_PATH', value: '/evil/libkrunfw.so' },
          { key: 'MSB_PROFILE', value: 'tampered' },
          { key: 'MSB_API_URL', value: 'https://evil.example.com' },
        ],
      }))

      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.MSB_HOME).toBe(path.join(process.env.HOME ?? os.homedir(), '.microsandbox'))
      expect(env.MSB_BACKEND).toBe('local')
      expect(env.MSB_PATH).toBe('msb')
      expect(env.MSB_LIBKRUNFW_PATH).toBeUndefined()
      expect(env.MSB_PROFILE).toBeUndefined()
      expect(env.MSB_API_URL).toBeUndefined()
    } finally {
      restoreMicrosandboxEnv(savedEnv)
    }
  })

  it('stamps manager-owned microsandbox control variables after user variables in the child environment', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const savedEnv = snapshotMicrosandboxEnv()
    try {
      clearMicrosandboxEnv()
      process.env.MSB_HOME = '/opt/manager-msb-home'
      process.env.MSB_BACKEND = 'local'
      process.env.MSB_LIBKRUNFW_PATH = '/opt/manager/libkrunfw.so'
      process.env.MSB_PROFILE = 'manager-profile'
      process.env.MSB_API_URL = 'https://manager.example.com'
      process.env.MSB_API_KEY = 'manager-key'
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPreferencesDb({
        serverEnvVars: [
          { key: 'MSB_HOME', value: '/evil/msb-home' },
          { key: 'MSB_LIBKRUNFW_PATH', value: '/evil/libkrunfw.so' },
        ],
      }))

      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.MSB_HOME).toBe('/opt/manager-msb-home')
      expect(env.MSB_BACKEND).toBe('local')
      expect(env.MSB_LIBKRUNFW_PATH).toBe('/opt/manager/libkrunfw.so')
      expect(env.MSB_PROFILE).toBe('manager-profile')
      expect(env.MSB_API_URL).toBe('https://manager.example.com')
      expect(env.MSB_API_KEY).toBe('manager-key')
    } finally {
      restoreMicrosandboxEnv(savedEnv)
    }
  })

  it('keeps manager-owned microsandbox control variables when enforcement is on', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const savedEnv = snapshotMicrosandboxEnv()
    try {
      clearMicrosandboxEnv()
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.OCM_SANDBOX_ENFORCED).toBe('true')
      expect(env.MSB_HOME).toBe(path.join(process.env.HOME ?? os.homedir(), '.microsandbox'))
      expect(env.MSB_BACKEND).toBe('local')
      expect(env.MSB_PATH).toBe('msb')
    } finally {
      restoreMicrosandboxEnv(savedEnv)
    }
  })

  it('stamps OPENCODE_PURE=false despite a user-supplied serverEnvVars entry', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [{ key: 'OPENCODE_PURE', value: 'true' }],
    }))

    await manager.start()

    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(env.OPENCODE_PURE).toBe('false')
  })

  it('strips an inherited OPENCODE_PURE from the manager process env before spawning', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    process.env.OPENCODE_PURE = 'true'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.OPENCODE_PURE).toBe('false')
    } finally {
      delete process.env.OPENCODE_PURE
    }
  })

  it('stamps OPENCODE_PURE=false in enforced mode despite inherited and configured values', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [{ key: 'OPENCODE_PURE', value: 'true' }],
    }))
    process.env.OPENCODE_PURE = 'true'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.OPENCODE_PURE).toBe('false')
      expect(env.OCM_SANDBOX_ENFORCED).toBe('true')
    } finally {
      delete process.env.OPENCODE_PURE
    }
  })

  it('captures the manager token in the spawned child environment at start time', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    let storedInternalToken: string | null = null
    const tokenDb = {
      prepare: vi.fn((sql: string) => ({
        get: (key?: string) => {
          if (sql.includes('SELECT value FROM app_secrets') && key === 'internal_token') {
            return storedInternalToken ? { value: storedInternalToken } : undefined
          }
          return undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO app_secrets') && args[0] === 'internal_token') {
            storedInternalToken = args[1] as string
          }
        },
        all: vi.fn(() => []),
      })),
      query: vi.fn((sql: string) => tokenDb.prepare(sql)),
    } as any
    manager.setDatabase(tokenDb)

    await manager.start()

    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(storedInternalToken).toBeTruthy()
    expect(env.OCM_INTERNAL_TOKEN).toBe(storedInternalToken)
  })

  it('passes through user-supplied OPENCODE_CONFIG_CONTENT and OPENCODE_CONFIG_DIR serverEnvVars', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [
        { key: 'OPENCODE_CONFIG_CONTENT', value: '{"plugin":["file:///evil.js"]}' },
        { key: 'OPENCODE_CONFIG_DIR', value: '/tmp/evil-config' },
      ],
    }))

    await manager.start()

    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"plugin":["file:///evil.js"]}')
    expect(env.OPENCODE_CONFIG_DIR).toBe('/tmp/evil-config')
  })

  it('passes inherited OPENCODE_CONFIG_CONTENT and OPENCODE_CONFIG_DIR through to the spawned env', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    process.env.OPENCODE_CONFIG_CONTENT = '{"plugin":["file:///evil.js"]}'
    process.env.OPENCODE_CONFIG_DIR = '/tmp/evil-config'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"plugin":["file:///evil.js"]}')
      expect(env.OPENCODE_CONFIG_DIR).toBe('/tmp/evil-config')
    } finally {
      delete process.env.OPENCODE_CONFIG_CONTENT
      delete process.env.OPENCODE_CONFIG_DIR
    }
  })

  it('honors a user-supplied HOME serverEnvVars entry while enforced', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [{ key: 'HOME', value: '/tmp/evil-home' }],
    }))

    await manager.start()

    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(env.HOME).toBe('/tmp/evil-home')
  })

  it('passes through user-supplied config-source and well-known auth serverEnvVars', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [
        { key: 'OPENCODE_AUTH_CONTENT', value: '{"https://evil.example.com":{"type":"wellknown","key":"K","token":"t"}}' },
        { key: 'OPENCODE_TEST_HOME', value: '/tmp/evil-home' },
        { key: 'OPENCODE_TEST_MANAGED_CONFIG_DIR', value: '/tmp/evil-managed' },
      ],
    }))

    await manager.start()

    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(env.OPENCODE_AUTH_CONTENT).toBe('{"https://evil.example.com":{"type":"wellknown","key":"K","token":"t"}}')
    expect(env.OPENCODE_TEST_HOME).toBe('/tmp/evil-home')
    expect(env.OPENCODE_TEST_MANAGED_CONFIG_DIR).toBe('/tmp/evil-managed')
  })

  it('passes inherited shell startup variables through to the spawned env', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    process.env.SHELL = '/workspace/repos/evil/evil-sh'
    process.env.BASH_ENV = '/workspace/repos/evil/rc'
    process.env.ENV = '/workspace/repos/evil/envrc'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.SHELL).toBe('/workspace/repos/evil/evil-sh')
      expect(env.BASH_ENV).toBe('/workspace/repos/evil/rc')
      expect(env.ENV).toBe('/workspace/repos/evil/envrc')
    } finally {
      delete process.env.SHELL
      delete process.env.BASH_ENV
      delete process.env.ENV
    }
  })

  it('passes inherited config-source env vars through to the spawned env', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    process.env.OPENCODE_AUTH_CONTENT = '{"https://evil.example.com":{"type":"wellknown","key":"K","token":"t"}}'
    process.env.OPENCODE_TEST_HOME = '/tmp/evil-home'
    process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = '/tmp/evil-managed'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.OPENCODE_AUTH_CONTENT).toBe('{"https://evil.example.com":{"type":"wellknown","key":"K","token":"t"}}')
      expect(env.OPENCODE_TEST_HOME).toBe('/tmp/evil-home')
      expect(env.OPENCODE_TEST_MANAGED_CONFIG_DIR).toBe('/tmp/evil-managed')
    } finally {
      delete process.env.OPENCODE_AUTH_CONTENT
      delete process.env.OPENCODE_TEST_HOME
      delete process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
    }
  })

  it('honors a user-supplied SHELL serverEnvVars entry and passes inherited shell vars through while enforced', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPreferencesDb({
      serverEnvVars: [{ key: 'SHELL', value: '/workspace/repos/evil/evil-sh' }],
    }))
    process.env.SHELL = '/workspace/repos/evil/evil-sh'
    process.env.BASH_ENV = '/workspace/repos/evil/rc'
    process.env.ENV = '/workspace/repos/evil/envrc'
    try {
      await manager.start()

      const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
      expect(env.SHELL).toBe('/workspace/repos/evil/evil-sh')
      expect(env.BASH_ENV).toBe('/workspace/repos/evil/rc')
      expect(env.ENV).toBe('/workspace/repos/evil/envrc')
    } finally {
      delete process.env.SHELL
      delete process.env.BASH_ENV
      delete process.env.ENV
    }
  })

  it('spawns the verified OpenCode executable by absolute path when resolvable', async () => {
    const accessSyncMock = accessSync as ReturnType<typeof vi.fn>
    const previousBin = process.env.OPENCODE_BIN
    process.env.OPENCODE_BIN = '/verified/bin/opencode'
    try {
      accessSyncMock.mockImplementation(() => undefined)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      await OpenCodeServerManager.getInstance().start()

      expect(spawnMock).toHaveBeenCalledWith(
        '/verified/bin/opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            OCM_SANDBOX_ENFORCED: 'false',
          }),
        }),
      )
    } finally {
      accessSyncMock.mockImplementation(() => {
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      if (previousBin === undefined) {
        delete process.env.OPENCODE_BIN
      } else {
        process.env.OPENCODE_BIN = previousBin
      }
    }
  })

  it('prefers the user-installed OpenCode executable over the bundled executable', () => {
    const accessSyncMock = accessSync as ReturnType<typeof vi.fn>
    try {
      accessSyncMock.mockImplementation((candidate) => {
        if (candidate === '/test/home/.opencode/bin/opencode' || candidate === '/usr/local/bin/opencode') return
        throw new Error('ENOENT')
      })

      expect(resolveOpenCodeExecutable()).toBe('/test/home/.opencode/bin/opencode')
    } finally {
      accessSyncMock.mockImplementation(() => {
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
    }
  })

  it('exposes the running child sandbox enforcement state for worktree placement', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()

    expect(manager.isSandboxEnforced()).toBe(false)

    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(manager.isSandboxEnforced()).toBe(true)
  })

  it('aborts startup when the sandbox enforcement state cannot be determined', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => {
        throw new Error('database unavailable')
      },
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('database unavailable')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('fails closed and terminates a surviving server when the sandbox enforcement state cannot be determined', async () => {
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => {
          throw new Error('database unavailable')
        },
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9999\n'
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('database unavailable')

      expect(manager.isSandboxEnforced()).toBe(true)
      expect(spawnMock).not.toHaveBeenCalled()
      expect(execSyncMock).toHaveBeenCalledWith('lsof -nP -t -iTCP:5551 -sTCP:LISTEN')
      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGKILL')
      expect(manager.isLastStartupErrorNonRecoverable()).toBe(true)
    } finally {
      killSpy.mockRestore()
    }
  })

  it('propagates the predecessor termination failure as non-recoverable when enforcement state cannot be determined', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill)
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => {
          throw new Error('database unavailable')
        },
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9999\n'
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('could not be proven terminated')

      expect(spawnMock).not.toHaveBeenCalled()
      expect(manager.isSandboxEnforced()).toBe(true)
      expect(manager.isLastStartupErrorNonRecoverable()).toBe(true)
      expect(manager.getLastStartupError()).toContain('database unavailable')
      expect(manager.getLastStartupError()).toContain('9999')
    } finally {
      killSpy.mockRestore()
    }
  }, 15000)

  it('stops the workspace sandbox when a restart disables enforcement', async () => {
    const stopWorkspaceSandboxForToggle = vi.fn().mockResolvedValue(undefined)
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
      stopWorkspaceSandboxForToggle,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    ;(manager as any).sandboxEnforced = true

    await manager.start()

    expect(stopWorkspaceSandboxForToggle).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'false',
        }),
      })
    )
  })

  it('does not stop the workspace sandbox when the restarted server stays enforced', async () => {
    const stopWorkspaceSandboxForToggle = vi.fn().mockResolvedValue(undefined)
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
      stopWorkspaceSandboxForToggle,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    ;(manager as any).sandboxEnforced = true

    await manager.start()

    expect(stopWorkspaceSandboxForToggle).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'true',
        }),
      })
    )
  })

  it('aborts the disabled restart when the workspace sandbox cannot be stopped', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
      stopWorkspaceSandboxForToggle: vi.fn().mockRejectedValue(new Error('msb stop failed; the managed microVM is still running')),
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    ;(manager as any).sandboxEnforced = true

    await expect(manager.start()).rejects.toThrow('Failed to stop the workspace sandbox while disabling enforcement')

    expect(spawnMock).not.toHaveBeenCalled()
    expect(manager.isSandboxEnforced()).toBe(true)
    expect(manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })

  it('replaces an existing healthy process in production when enforcement is enabled', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) {
          return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        }
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            OCM_SANDBOX_ENFORCED: 'true',
          }),
        })
      )
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates the whole process group when stopping a detached production child', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    let groupChecks = 0
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === -1234) {
          if (signal === 0) {
            groupChecks += 1
            if (groupChecks === 1) return true
            const error = new Error('No such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          }
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      await manager.stop()

      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(1234, 'SIGTERM')
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('starts and stops an unenforced production server on non-Linux hosts without /proc attestation', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockImplementation(((filePath: unknown) => {
        if (String(filePath).startsWith('/proc/')) {
          const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return ''
      }) as typeof readFileSyncMock)
      forceProcessAttestation(false)
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === 1234 && signal === 0) {
          const error = new Error('No such process') as NodeJS.ErrnoException
          error.code = 'ESRCH'
          throw error
        }
        return true
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({ detached: true }),
      )
      expect(manager.isSandboxEnforced()).toBe(false)

      await manager.stop()

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM')
      expect((manager as any).serverPid).toBeNull()
      expect((manager as any).isHealthy).toBe(false)
    } finally {
      killSpy.mockRestore()
      readFileSyncMock.mockReturnValue(procStatString(1234, '42'))
      forceProcessAttestation(true)
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('fails closed when enforcement is on and process identity attestation is unavailable', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockImplementation(((filePath: unknown) => {
        if (String(filePath).startsWith('/proc/')) {
          const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return ''
      }) as typeof readFileSyncMock)
      forceProcessAttestation(false)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('process identity attestation, which is unavailable on this platform')

      expect(spawnMock).not.toHaveBeenCalled()
      expect(manager.isSandboxEnforced()).toBe(true)
      expect(manager.isLastStartupErrorNonRecoverable()).toBe(true)
    } finally {
      readFileSyncMock.mockReturnValue(procStatString(1234, '42'))
      forceProcessAttestation(true)
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('keeps the child state marker and fails the stop when the process group survives SIGKILL', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      killSpy.mockImplementation(((pid: number) => {
        if (pid === -1234) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      rmMock.mockClear()

      await expect(manager.stop()).rejects.toThrow('refusing to complete the stop')
      expect(rmMock).not.toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
      expect((manager as any).serverPid).not.toBeNull()
      expect((manager as any).isHealthy).toBe(false)
      expect(manager.getLastStartupError()).toContain('1234')
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('keeps the child state marker and fails the stop when the leader has exited but an attested group member survives', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readdirSyncMock.mockReturnValue(['1234', '1235'])
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithGroup(1234, '42')
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 1234)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      killSpy.mockImplementation(((pid: number) => {
        if (pid === -1234) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerCall = writeFileMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerCall).toBeDefined()
      const markerContent = markerCall![1] as string
      expect(JSON.parse(markerContent)).toMatchObject({
        pid: 1234,
        pgid: 1234,
        groupMembers: [
          { pid: 1234, startToken: '42' },
          { pid: 1235, startToken: '77' },
        ],
      })

      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 1234)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      readdirSyncMock.mockReturnValue(['1235'])
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(markerContent)
        }
        return Promise.resolve(undefined)
      })
      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      rmMock.mockClear()

      await expect(manager.stop()).rejects.toThrow('refusing to complete the stop')
      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGKILL')
      expect(rmMock).not.toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
      expect((manager as any).serverPid).not.toBeNull()
      expect((manager as any).isHealthy).toBe(false)
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('fails a restart and keeps the child state marker when the process group survives SIGKILL', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      killSpy.mockImplementation(((pid: number) => {
        if (pid === -1234) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      rmMock.mockClear()

      await expect(manager.restart()).rejects.toThrow('refusing to complete the stop')
      expect(rmMock).not.toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
      expect((manager as any).isHealthy).toBe(false)
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('rejects a restart with a busy error instead of silently treating contention as success', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    ;(manager as unknown as { opInProgress: boolean }).opInProgress = true

    await expect(manager.restart()).rejects.toThrow('Another OpenCode server operation is already in progress')
    await expect(manager.reloadConfig()).rejects.toThrow('Another OpenCode server operation is already in progress')
    await expect(manager.start()).rejects.toThrow('Another OpenCode server operation is already in progress')
  })

  it('terminates an attested surviving process group when the tracked leader has already exited and removes the marker', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    let groupChecks = 0
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readdirSyncMock.mockReturnValue(['1234', '1235'])
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithGroup(1234, '42')
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 1234)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === -1234) {
          if (signal === 0) {
            groupChecks += 1
            if (groupChecks === 1) return true
            const error = new Error('No such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          }
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerCall = writeFileMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerCall).toBeDefined()
      const markerContent = markerCall![1] as string

      const spawnedChild = spawnMock.mock.results[0]!.value as { pid: number; on: ReturnType<typeof vi.fn> }
      const exitCall = spawnedChild.on.mock.calls.find((call: unknown[]) => call[0] === 'exit')
      expect(exitCall).toBeDefined()
      ;(exitCall![1] as (code: number | null, signal: NodeJS.Signals | null) => void)(0, null)
      expect((manager as any).serverPid).toBeNull()

      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 1234)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      readdirSyncMock.mockReturnValue(['1235'])
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(markerContent)
        }
        return Promise.resolve(undefined)
      })
      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      rmMock.mockClear()

      await manager.stop()

      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM')
      expect(rmMock).toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
      expect((manager as any).serverPid).toBeNull()
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('reconciles an attested surviving descendant group before an unenforced replacement start', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    let groupChecks = 0
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      const marker = JSON.stringify({
        pid: 9999,
        pgid: 9999,
        enforced: false,
        startToken: 'old-token',
        generation: 0,
        groupMembers: [
          { pid: 9999, startToken: 'old-token' },
          { pid: 1235, startToken: '77' },
        ],
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) return Promise.resolve(marker)
        return Promise.resolve(undefined)
      })
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithGroup(1234, 'new-token')
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 9999)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      readdirSyncMock.mockReturnValue(['1235'])
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return ''
        throw new Error('not found')
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === -9999) {
          if (signal === 0) {
            groupChecks += 1
            if (groupChecks === 1) return true
            const error = new Error('No such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          }
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(spawnMock).toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('fails closed and refuses to replace the child state marker when the surviving group cannot be proven to be the predecessor', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      const marker = JSON.stringify({
        pid: 9999,
        pgid: 9999,
        enforced: false,
        startToken: 'old-token',
        generation: 0,
        groupMembers: [{ pid: 9999, startToken: 'old-token' }],
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) return Promise.resolve(marker)
        return Promise.resolve(undefined)
      })
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 9999)
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      readdirSyncMock.mockReturnValue(['1235'])
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return ''
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('refusing to replace the child state marker while live processes may survive')

      expect(spawnMock).not.toHaveBeenCalled()
      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      expect(rmMock).not.toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
      expect(manager.getLastStartupError()).toContain('9999')
    } finally {
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('restricts port-owner inspection to listening TCP sockets', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const capturedCommands: string[] = []
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        capturedCommands.push(cmd)
        return ''
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(capturedCommands).toContain('lsof -nP -t -iTCP:5551 -sTCP:LISTEN')
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates the attested predecessor process group before an enforced start', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    let groupChecks = 0
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) {
          return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        }
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(9999, '42'))
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: false, startToken: '42', generation: 0 }))
        }
        return Promise.resolve(undefined)
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === -9999) {
          if (signal === 0) {
            groupChecks += 1
            if (groupChecks === 1) return true
            const error = new Error('No such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          }
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ OCM_SANDBOX_ENFORCED: 'true' }),
        })
      )
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates the predecessor process group via the persisted group id when the leader has exited and a recorded member still survives', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    let groupChecks = 0
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      readdirSyncMock.mockReturnValue(['10001'])
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/9999/stat')) {
          const error = new Error('No such process') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        if (String(filePath).includes('/proc/10001/stat')) {
          return procStatStringWithPgrp(10001, '77', 9999)
        }
        return procStatStringWithGroup(1234, '42')
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(
            JSON.stringify({
              pid: 9999,
              pgid: 9999,
              enforced: false,
              startToken: '42',
              generation: 0,
              groupMembers: [{ pid: 10001, startToken: '77' }],
            }),
          )
        }
        return Promise.resolve(undefined)
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === -9999) {
          if (signal === 0) {
            groupChecks += 1
            if (groupChecks === 1) return true
            const error = new Error('No such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          }
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(9999, 'SIGTERM')
      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ OCM_SANDBOX_ENFORCED: 'true' }),
        }),
      )
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('refuses an enforced start when a reused process group cannot be proven to belong to the exited leader', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return ''
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      readdirSyncMock.mockReturnValue(['10001'])
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/9999/stat')) {
          return procStatStringWithGroup(9999, '77')
        }
        if (String(filePath).includes('/proc/10001/stat')) {
          return procStatStringWithPgrp(10001, '88', 9999)
        }
        return procStatStringWithGroup(1234, '42')
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(
            JSON.stringify({
              pid: 9999,
              pgid: 9999,
              enforced: false,
              startToken: '42',
              generation: 0,
              groupMembers: [],
            }),
          )
        }
        return Promise.resolve(undefined)
      })
      killSpy.mockImplementation(((pid: number) => {
        if (pid === -9999) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('cannot be proven to belong to it')
      expect(manager.getLastStartupError()).toContain('9999')
      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGKILL')
      expect(killSpy).not.toHaveBeenCalledWith(9999, 'SIGTERM')
      expect(spawnMock).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('never signals a reused PID whose identity does not match the child state marker', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/9999/stat')) {
          return procStatStringWithGroup(9999, '77')
        }
        return procStatStringWithGroup(1234, '42')
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(
            JSON.stringify({ pid: 9999, pgid: 9999, enforced: false, startToken: '42', generation: 0 }),
          )
        }
        return Promise.resolve(undefined)
      })
      killSpy.mockImplementation(() => {
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(killSpy).not.toHaveBeenCalledWith(9999, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(9999, 'SIGKILL')
      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ OCM_SANDBOX_ENFORCED: 'true' }),
        }),
      )
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('refuses an enforced start when the attested predecessor process group retains live members', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9999\n'
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(9999, '42'))
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: false, startToken: '42', generation: 0 }))
        }
        return Promise.resolve(undefined)
      })
      killSpy.mockImplementation(((pid: number) => {
        if (pid === -9999) {
          return true
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('refusing to start an enforced server')
      expect(manager.getLastStartupError()).toContain('9999')
      expect(spawnMock).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('aborts an enforced replacement when an existing port owner survives the termination attempts', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9998\n'
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === 9998) {
          if (signal === 0) return true
          const error = new Error('Operation not permitted') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('still own the port')
      expect(manager.getLastStartupError()).toContain('9998')
      expect(spawnMock).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('refuses to mark a replacement healthy when the new process does not own the port', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9997\n'
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === 1234 && signal !== 0) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('does not own the OpenCode port')
      expect(manager.getLastStartupError()).toContain('1234')
      expect(manager.getLastStartupError()).toContain('9997')
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('refuses an enforced fresh start when the spawned process does not own the port', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => true,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '8888\n' : ''
        if (cmd.includes('opencode --version')) return '1.18.16\n'
        throw new Error('not found')
      })
      killSpy.mockImplementation(((pid: number, signal?: number | string) => {
        if (pid === 1234 && signal !== 0) return true
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }) as typeof process.kill)
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('does not own the OpenCode port')
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(manager.getLastStartupError()).toContain('1234')
      expect(manager.getLastStartupError()).toContain('8888')
      expect((manager as any).isHealthy).toBe(false)
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('fails an enforced start when the port owner inspection cannot run', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation(() => {
      throw new Error('lsof is not installed')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('Cannot inspect port 5551 ownership')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })

  it('refuses to signal a reused PID whose identity no longer matches the child state marker on stop', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      rmMock.mockClear()
      killSpy.mockClear()
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithGroup(1234, 'reused-token')
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 1234, pgid: 1234, enforced: false, startToken: '42', generation: 0, groupMembers: [] }))
        }
        return Promise.resolve(undefined)
      })

      await manager.stop()

      expect(killSpy).not.toHaveBeenCalledWith(1234, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(-1234, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(1234, 'SIGKILL')
      expect(rmMock).not.toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode-server-child.json',
        { force: true },
      )
    } finally {
      killSpy.mockRestore()
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('does not signal a PID on stop once the tracked child has exited', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill')
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      const spawnedChild = spawnMock.mock.results[0]!.value as { pid: number; on: ReturnType<typeof vi.fn> }
      const exitCall = spawnedChild.on.mock.calls.find((call: unknown[]) => call[0] === 'exit')
      ;(exitCall![1] as (code: number | null, signal: NodeJS.Signals | null) => void)(0, null)
      expect((manager as any).serverPid).toBeNull()
      expect((manager as any).isHealthy).toBe(false)

      killSpy.mockClear()
      await manager.stop()

      expect(killSpy).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('adopts an existing healthy process in production when enforcement is off and the child state is attested as unenforced', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return '9999\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatString(9999, '42'))
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: false, startToken: '42', generation: 0 }))
        }
        return Promise.resolve(undefined)
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).not.toHaveBeenCalled()
      expect(manager.isSandboxEnforced()).toBe(false)
    } finally {
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  })

  it('writes a durable child state marker with pid, enforcement, identity, and generation for a production spawn', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerCall = writeFileMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerCall).toBeDefined()
      const marker = JSON.parse(markerCall![1] as string) as Record<string, unknown>
      expect(marker).toEqual({ pid: 1234, pgid: null, enforced: false, startToken: '42', generation: 0, groupMembers: [] })
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  })

  it('stops the child state marker refresh when the tracked child exits', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatStringWithGroup(1234, '42'))
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      const spawnedChild = spawnMock.mock.results[0]!.value as { pid: number; on: ReturnType<typeof vi.fn> }
      const exitCall = spawnedChild.on.mock.calls.find((call: unknown[]) => call[0] === 'exit')
      expect(exitCall).toBeDefined()
      expect((manager as any).markerRefreshTimer).not.toBeNull()

      ;(exitCall![1] as (code: number | null, signal: NodeJS.Signals | null) => void)(1, null)

      expect((manager as any).markerRefreshTimer).toBeNull()
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('does not record reused process-group members into the child state marker after the tracked child exits', async () => {
    const marker = JSON.stringify({
      pid: 1234,
      pgid: 1234,
      enforced: false,
      startToken: '42',
      generation: 0,
      groupMembers: [{ pid: 1234, startToken: '42' }],
    })
    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.includes('opencode-server-child.json')) return Promise.resolve(marker)
      return Promise.resolve(undefined)
    })
    readFileSyncMock.mockImplementation(() => {
      const error = new Error('No such process') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    readdirSyncMock.mockReturnValue(['7777'])
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    ;(manager as any).startChildStateMarkerRefresh()
    try {
      await (manager as any).refreshChildStateMarkerMembers()

      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerWrites = writeFileMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerWrites).toHaveLength(0)
      expect((manager as any).markerRefreshTimer).toBeNull()
    } finally {
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
    }
  })

  it('does not refresh the child state marker when the tracked leader PID is reused with a different identity', async () => {
    const marker = JSON.stringify({
      pid: 1234,
      pgid: 1234,
      enforced: false,
      startToken: '42',
      generation: 0,
      groupMembers: [{ pid: 1234, startToken: '42' }],
    })
    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.includes('opencode-server-child.json')) return Promise.resolve(marker)
      return Promise.resolve(undefined)
    })
    readFileSyncMock.mockImplementation((filePath: string) => {
      if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithPgrp(1234, 'reused-token', 1234)
      const error = new Error('No such process') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    ;(manager as any).startChildStateMarkerRefresh()
    try {
      await (manager as any).refreshChildStateMarkerMembers()

      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerWrites = writeFileMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerWrites).toHaveLength(0)
      expect((manager as any).markerRefreshTimer).toBeNull()
    } finally {
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
    }
  })

  it('updates the child state marker with live attested group members while the tracked child is running', async () => {
    const marker = JSON.stringify({
      pid: 1234,
      pgid: 1234,
      enforced: false,
      startToken: '42',
      generation: 0,
      groupMembers: [{ pid: 1234, startToken: '42' }],
    })
    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.includes('opencode-server-child.json')) return Promise.resolve(marker)
      return Promise.resolve(undefined)
    })
    readdirSyncMock.mockReturnValue(['1234', '1235'])
    readFileSyncMock.mockImplementation((filePath: string) => {
      if (String(filePath).includes('/proc/1234/stat')) return procStatStringWithGroup(1234, '42')
      if (String(filePath).includes('/proc/1235/stat')) return procStatStringWithPgrp(1235, '77', 1234)
      const error = new Error('No such process') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    ;(manager as any).startChildStateMarkerRefresh()
    try {
      await (manager as any).refreshChildStateMarkerMembers()

      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerCall = writeFileMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerCall).toBeDefined()
      expect(JSON.parse(markerCall![1] as string)).toMatchObject({
        pid: 1234,
        pgid: 1234,
        startToken: '42',
        groupMembers: [
          { pid: 1234, startToken: '42' },
          { pid: 1235, startToken: '77' },
        ],
      })
      expect((manager as any).markerRefreshTimer).not.toBeNull()
    } finally {
      readFileMock.mockReset()
      readFileSyncMock.mockReset()
      readdirSyncMock.mockReset()
    }
  })

  it('fails production startup and terminates the spawned child when the child state marker cannot be persisted', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('No such process') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      writeFileMock.mockImplementation((filePath: unknown) =>
        String(filePath).includes('opencode-server-child.json')
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve(),
      )
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await expect(manager.start()).rejects.toThrow('Failed to persist the OpenCode child state marker: disk full')

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM')
      expect((manager as any).isHealthy).toBe(false)
      expect((manager as any).serverPid).toBeNull()
      expect(manager.getLastStartupError()).toContain('Failed to persist the OpenCode child state marker')
    } finally {
      ;(fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockReset()
      killSpy.mockRestore()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates a healthy existing process whose child state identity does not match the surviving process', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatString(9999, 'new-token'))
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: false, startToken: 'old-token', generation: 0 }))
        }
        return Promise.resolve(undefined)
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalled()
    } finally {
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates a healthy existing process carrying a legacy child state marker without an identity', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        throw new Error('not found')
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: false, writtenAt: Date.now() }))
        }
        return Promise.resolve(undefined)
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalled()
    } finally {
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('removes the child state marker after a confirmed stop', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation(() => {
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()
      await manager.stop()

      const rmMock = fs.rm as unknown as ReturnType<typeof vi.fn>
      expect(rmMock).toHaveBeenCalledWith('/test/workspace/.opencode/state/opencode-server-child.json', { force: true })
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates a healthy surviving child when a restart-sensitive change was persisted after the marker was written', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof') && spawnMock.mock.calls.length > 0) return '1234\n'
        throw new Error('not found')
      })
      readFileSyncMock.mockReturnValue(procStatString(1234, '42'))
      const db = createGenerationDb()
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const firstManager = OpenCodeServerManager.getInstance()
      firstManager.setDatabase(db)

      await firstManager.start()
      const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>
      const markerCall = writeFileMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('opencode-server-child'))
      expect(markerCall).toBeDefined()
      const markerContent = markerCall![1] as string
      expect(JSON.parse(markerContent)).toMatchObject({ pid: 1234, enforced: false, generation: 0 })

      firstManager.markRestartPending()

      OpenCodeServerManager.resetInstance()
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(markerContent)
        }
        return Promise.resolve(undefined)
      })
      const secondManager = OpenCodeServerManager.getInstance()
      secondManager.setDatabase(db)

      await secondManager.start()

      expect(spawnMock).toHaveBeenCalledTimes(2)
    } finally {
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates a healthy existing process stamped as enforced when the sandbox preference is off', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        throw new Error('not found')
      })
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath.includes('opencode-server-child.json')) {
          return Promise.resolve(JSON.stringify({ pid: 9999, enforced: true, writtenAt: Date.now() }))
        }
        return Promise.resolve(undefined)
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            OCM_SANDBOX_ENFORCED: 'false',
          }),
        }),
      )
      expect(manager.isSandboxEnforced()).toBe(false)
    } finally {
      readFileMock.mockReset()
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('terminates a healthy existing process whose enforcement stamp cannot be attested when the preference is off', async () => {
    const originalNodeEnv = ENV.SERVER.NODE_ENV
    Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
    try {
      sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
        isEnabled: () => false,
      }))
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : '9999\n'
        throw new Error('not found')
      })
      const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
      const manager = OpenCodeServerManager.getInstance()
      manager.setDatabase(createPasswordDb(null))

      await manager.start()

      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            OCM_SANDBOX_ENFORCED: 'false',
          }),
        }),
      )
    } finally {
      Object.defineProperty(ENV.SERVER, 'NODE_ENV', { value: originalNodeEnv, configurable: true, writable: true })
    }
  }, 15000)

  it('installs the generated plugins into the same config dir', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    await OpenCodeServerManager.getInstance().start()

    expect(installManagedPluginsMock).toHaveBeenCalledWith('/test/workspace/.config')
  })

  it('installs all generated plugins into the same auto-discovery config dir', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    await OpenCodeServerManager.getInstance().start()

    expect(installManagedPluginsMock).toHaveBeenCalledWith('/test/workspace/.config')
  })

  it('aborts enforced startup when the gh-env plugin cannot be installed', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    installManagedPluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('readonly filesystem')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('continues startup without enforcement when the gh-env plugin cannot be installed', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    installManagedPluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalled()
  })

  it('restores legacy quarantined plugins before an enforced start', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(restoreQuarantinedOpenCodePluginsMock).toHaveBeenCalledWith(
      '/test/workspace/.config',
      '/test/workspace/.config/opencode.json',
    )
  })

  it('restores legacy quarantined plugins before a non-enforced start', async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    await OpenCodeServerManager.getInstance().start()

    expect(restoreQuarantinedOpenCodePluginsMock).toHaveBeenCalledWith(
      '/test/workspace/.config',
      '/test/workspace/.config/opencode.json',
    )
  })

  it('spawns an enforced server without disabling project config', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'true',
        }),
      })
    )
    const env = (spawnMock.mock.calls[0] as unknown as [unknown, unknown, { env: Record<string, string> }])[2].env
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined()
  })

  it('aborts an enforced start when legacy quarantined plugins cannot be restored', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    restoreQuarantinedOpenCodePluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('readonly filesystem')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('aborts a non-enforced start when quarantined plugins cannot be restored', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    restoreQuarantinedOpenCodePluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('readonly filesystem')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('aborts enforced startup when the sandbox plugin cannot be installed', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    installManagedPluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await expect(manager.start()).rejects.toThrow('readonly filesystem')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('continues startup without enforcement when the sandbox plugin cannot be installed', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    installManagedPluginsMock.mockRejectedValueOnce(new Error('readonly filesystem'))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalled()
  })

  it('starts an enforced server on any OpenCode build', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => true,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('lsof')) return spawnMock.mock.calls.length > 0 ? '1234\n' : ''
      if (cmd.includes('opencode --version')) return '1.18.16\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          OCM_SANDBOX_ENFORCED: 'true',
        }),
      })
    )
  })

  it('does not block an incompatible OpenCode build when enforcement is off', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('opencode --version')) return '1.18.15\n'
      throw new Error('not found')
    })
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    await manager.start()

    expect(spawnMock).toHaveBeenCalled()
  })

  it('keeps a restart request pending when it is marked during startup', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))

    let marked = false
    createOpenCodeClientMock.mockImplementation(() => ({
      forward: vi.fn().mockImplementation(async () => {
        if (!marked) {
          marked = true
          manager.markRestartPending()
        }
        return new Response(null, { status: 200 })
      }),
      forwardRaw: vi.fn(),
      getJson: vi.fn(),
      postJson: vi.fn(),
      setProviderAuth: vi.fn(),
      deleteProviderAuth: vi.fn(),
    }))

    await manager.start()

    expect(manager.isRestartPending()).toBe(true)
  })

  it('clears a restart request when no newer change arrives during startup', async () => {
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    const manager = OpenCodeServerManager.getInstance()
    manager.setDatabase(createPasswordDb(null))
    manager.markRestartPending()

    await manager.start()

    expect(manager.isRestartPending()).toBe(false)
  })

  function setOpenCodeEnv(values: { host: string; password: string }) {
    Object.defineProperty(ENV.OPENCODE, 'HOST', { value: values.host, configurable: true, writable: true })
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', { value: values.password, configurable: true, writable: true })
  }

  function procStatString(pid: number, startToken: string): string {
    const fields = Array.from({ length: 30 }, (_, index) => String(index + 1))
    fields[19] = startToken
    return `${pid} (opencode) ${fields.join(' ')}`
  }

  function procStatStringWithGroup(pid: number, startToken: string): string {
    const fields = Array.from({ length: 30 }, (_, index) => String(index + 1))
    fields[2] = String(pid)
    fields[19] = startToken
    return `${pid} (opencode) ${fields.join(' ')}`
  }

  function procStatStringWithPgrp(pid: number, startToken: string, pgrp: number): string {
    const fields = Array.from({ length: 30 }, (_, index) => String(index + 1))
    fields[2] = String(pgrp)
    fields[19] = startToken
    return `${pid} (opencode) ${fields.join(' ')}`
  }

  function createPasswordDb(password: string | null) {
    const encrypted = password ? encryptSecret(password) : null

    const db = {
      prepare: vi.fn((sql: string) => ({
        get: (key?: string) => {
          if (key === 'opencode_server_password' && sql.includes('SELECT value FROM app_secrets') && encrypted) {
            return { value: encrypted }
          }
          return undefined
        },
        run: vi.fn(),
        all: vi.fn(() => []),
      })),
      query: vi.fn((sql: string) => db.prepare(sql)),
    }

    return db as any
  }

  function createGenerationDb() {
    let generation = 0
    const db = {
      prepare: vi.fn((sql: string) => ({
        get: (key?: string) => {
          if (sql.includes('FROM app_secrets') && key === 'opencode_restart_generation') {
            return { value: String(generation) }
          }
          return undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INTO app_secrets') && args[0] === 'opencode_restart_generation') {
            generation = Number(args[1])
          }
        },
        all: vi.fn(() => []),
      })),
      query: vi.fn((sql: string) => db.prepare(sql)),
    }

    return db as any
  }

  function createPreferencesDb(preferences: Record<string, unknown>) {
    const db = {
      prepare: vi.fn((sql: string) => ({
        get: (key?: string) => {
          if (sql.includes('FROM user_preferences') && key === 'default') {
            return { preferences: JSON.stringify(preferences), updated_at: Date.now() }
          }
          return undefined
        },
        run: vi.fn(),
        all: vi.fn(() => []),
      })),
      query: vi.fn((sql: string) => db.prepare(sql)),
    }

    return db as any
  }
})

describe('OpenCodeServerManager - reinitializeBinDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKSPACE_PATH = '/test/workspace'
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.WORKSPACE_PATH
  })

  describe('Success Cases', () => {
    it('should create directory and initialize when package.json does not exist', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      const enoentError = new Error('File not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockReturnValue(Buffer.from('Success'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(mkdirMock).toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode/bin',
        { recursive: true }
      )
      expect(execSyncMock).toHaveBeenCalledWith(
        'bun init -y',
        expect.objectContaining({
          cwd: '/test/workspace/.opencode/state/opencode/bin',
          stdio: 'inherit',
          timeout: 30000
        })
      )
      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
      expect(logger.info).toHaveBeenCalledWith('OpenCode bin directory initialized successfully')
    })

    it('should skip initialization when package.json already exists', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      accessMock.mockResolvedValue(undefined)

      await opencodeServerManager.reinitializeBinDirectory()

      expect(mkdirMock).toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode/bin',
        { recursive: true }
      )
      expect(execSyncMock).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
    })

    it('should log reinitialization message', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      accessMock.mockResolvedValue(undefined)

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
    })
  })

  describe('Error Handling', () => {
    it('should handle bun init failure gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      const enoentError = new Error('Not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockImplementation(() => {
        throw new Error('bun init failed')
      })

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith('bun init failed:', expect.any(Error))
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })

    it('should handle directory creation failure gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockRejectedValue(new Error('Permission denied'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle fs.access throwing non-ENOENT error gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockResolvedValue(undefined)
      accessMock.mockRejectedValue(new Error('Permission denied'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(execSyncMock).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })

    it('should handle timeout during bun init', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockResolvedValue(undefined)
      const enoentError = new Error('Not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockImplementation(() => {
        const error = new Error('Command timed out')
        error.name = 'ETIMEDOUT'
        throw error
      })

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith('bun init failed:', expect.any(Error))
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })
  })
})

describe('ConfigReloadError', () => {
  it('should create error with validation issues and removed fields', () => {
    const issues = [{ path: 'command.review', message: 'Invalid' }]
    const removed = ['command.review']
    const error = new ConfigReloadError('Test error', issues, removed)

    expect(error.name).toBe('ConfigReloadError')
    expect(error.message).toBe('Test error')
    expect(error.validationIssues).toEqual(issues)
    expect(error.removedFields).toEqual(removed)
  })

  it('should default to empty arrays for issues and removed fields', () => {
    const error = new ConfigReloadError('Test error')

    expect(error.validationIssues).toEqual([])
    expect(error.removedFields).toEqual([])
  })
})

describe('OpenCodeServerManager - reloadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should read config from file before patching', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify({ command: { review: 'test' } }))
    fs.readFile = mockReadFile

    const { patchConfigWithRecovery } = await import('../../src/services/opencode/config-recovery')
    const mockPatchResult = { success: true }
    vi.mocked(patchConfigWithRecovery).mockResolvedValue(mockPatchResult as any)

    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { createStubOpenCodeClient } = await import('../helpers/stub-opencode-client')
    opencodeServerManager.setOpenCodeClient(createStubOpenCodeClient())

    await opencodeServerManager.reloadConfig()

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('.config/opencode.json'),
      'utf-8'
    )
    expect(patchConfigWithRecovery).toHaveBeenCalled()
  })

  it('passes a config with plugins through to the live reload patch unchanged', async () => {
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { patchConfigWithRecovery } = await import('../../src/services/opencode/config-recovery')
    vi.mocked(patchConfigWithRecovery).mockResolvedValue({ success: true } as any)
    const { createStubOpenCodeClient } = await import('../helpers/stub-opencode-client')
    opencodeServerManager.setOpenCodeClient(createStubOpenCodeClient())
    fs.readFile = vi.fn().mockResolvedValue(JSON.stringify({ plugin: ['evil-plugin'], model: 'x' }))

    await opencodeServerManager.reloadConfig()

    const patchTarget = vi.mocked(patchConfigWithRecovery).mock.calls[0]![1]
    expect(patchTarget).toEqual({ plugin: ['evil-plugin'], model: 'x' })
  })

  it('passes a plugin-free config through to the live reload patch unchanged', async () => {
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { patchConfigWithRecovery } = await import('../../src/services/opencode/config-recovery')
    vi.mocked(patchConfigWithRecovery).mockResolvedValue({ success: true } as any)
    const { createStubOpenCodeClient } = await import('../helpers/stub-opencode-client')
    opencodeServerManager.setOpenCodeClient(createStubOpenCodeClient())
    fs.readFile = vi.fn().mockResolvedValue(JSON.stringify({ model: 'x' }))

    await opencodeServerManager.reloadConfig()

    const patchTarget = vi.mocked(patchConfigWithRecovery).mock.calls[0]![1]
    expect(patchTarget).toEqual({ model: 'x' })
  })
})

describe('OpenCodeServerManager - checkHealth', () => {
  it('uses the OpenCode liveness endpoint', async () => {
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { createStubOpenCodeClient } = await import('../helpers/stub-opencode-client')
    const forward = vi.fn(async () => new Response(JSON.stringify({ healthy: true }), { status: 200 }))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    opencodeServerManager.setOpenCodeClient(createStubOpenCodeClient({ forward }))

    await opencodeServerManager.checkHealth()

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/global/health',
      signal: expect.any(AbortSignal),
    }))
    expect(timeout).toHaveBeenCalledWith(ENV.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS)
  })

  it('returns false when the upstream times out and aborts the upstream fetch', async () => {
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { createStubOpenCodeClient } = await import('../helpers/stub-opencode-client')

    let capturedSignal: AbortSignal | undefined
    let aborted = false
    const stubClient = createStubOpenCodeClient({
      forward: vi.fn(async (req: { signal?: AbortSignal }) => {
        capturedSignal = req.signal
        return await new Promise<Response>((resolve) => {
          req.signal?.addEventListener('abort', () => {
            aborted = true
            resolve(new Response(JSON.stringify({ error: 'Proxy request failed' }), { status: 502 }))
          })
        })
      }),
    })
    opencodeServerManager.setOpenCodeClient(stubClient)

    const healthy = await opencodeServerManager.checkHealth()

    expect(healthy).toBe(false)
    expect(capturedSignal).toBeDefined()
    expect(aborted).toBe(true)
  }, 5000)
})

describe('OpenCodeServerManager - configured plugin install', () => {
  beforeEach(async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    OpenCodeServerManager.resetInstance()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
    OpenCodeServerManager.resetInstance()
    vi.clearAllMocks()
  })

  it('bounds first-run plugin installation with a timeout', async () => {
    const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
    const { logger } = await import('../../src/utils/logger')

    accessMock.mockImplementation((filePath: string) => {
      const error = new Error('Not found') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      return filePath.includes('package.json') ? Promise.reject(error) : Promise.resolve()
    })
    childSpawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: null, stdout: '', stderr: '', error: new Error('spawnSync bun ETIMEDOUT') })

    await (opencodeServerManager as any).installConfiguredPlugins(['test-plugin'])

    expect(childSpawnSyncMock).toHaveBeenCalledWith(
      'bun',
      ['add', '--ignore-scripts', 'test-plugin@latest'],
      expect.objectContaining({ timeout: 120000 }),
    )
    expect(logger.warn).toHaveBeenCalledWith('Failed to install OpenCode plugin test-plugin: spawnSync bun ETIMEDOUT')
  })
})
