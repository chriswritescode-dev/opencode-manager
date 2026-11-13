import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { ENV } from '@opencode-manager/shared/config/env'
import { z } from 'zod'
import {
  ConfigReloadError,
  resolveOpenCodeExecutable,
  type OpenCodeServerManager,
} from '../../src/services/opencode-single-server'
import { getOpenCodeServiceSettingsPath } from '../../src/services/opencode-service-mode'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { readManagerLogEntries } from '../../src/utils/log-buffer'
import { expectLoggedMessage } from '../helpers/log-assertions'
import { applyTestEnv } from '../helpers/test-env'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import {
  FakeServerChild,
  createOpenCodeServerHarness,
  createOpenCodeServerTestContext,
  DEFAULT_SERVER_INFO,
  type OpenCodeServerTestContext,
} from '../helpers/opencode-server-harness'

const originalHost = ENV.OPENCODE.HOST
const originalPassword = ENV.OPENCODE.SERVER_PASSWORD

function setOpenCodeEnv(values: { host?: string; password?: string }): void {
  if (values.host !== undefined) {
    Object.defineProperty(ENV.OPENCODE, 'HOST', { value: values.host, configurable: true, writable: true })
  }
  if (values.password !== undefined) {
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', { value: values.password, configurable: true, writable: true })
  }
}

function serviceRegistrationPath(workspacePath: string): string {
  return path.join(workspacePath, '.opencode', 'state', 'opencode', 'service.json')
}

const ServiceSettingsSchema = z.object({ password: z.string() })

async function readServiceSettings(): Promise<{ password: string; mode: number }> {
  const settingsPath = getOpenCodeServiceSettingsPath()
  const parsed = ServiceSettingsSchema.parse(JSON.parse(await readFile(settingsPath, 'utf-8')))
  const mode = (await stat(settingsPath)).mode & 0o777
  return { password: parsed.password, mode }
}

function createContext(nodeEnv?: string): OpenCodeServerTestContext {
  const context = createOpenCodeServerTestContext({ nodeEnv })
  context.harness.manager.setDatabase(context.db)
  return context
}

describe('OpenCodeServerManager - client credentials', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: '' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('rebuilds the client with the env password when no database password is stored', async () => {
    setOpenCodeEnv({ password: 'envpassword123' })

    await context.harness.manager.rebuildClient()

    expect(context.harness.createOpenCodeClient).toHaveBeenCalledWith('envpassword123', '127.0.0.1')
  })

  it('prefers the stored database password over the env password', async () => {
    setOpenCodeEnv({ password: 'envpassword123' })
    new SettingsService(context.db).setOpenCodeServerPassword('dbpassword123')

    await context.harness.manager.rebuildClient()

    expect(context.harness.createOpenCodeClient).toHaveBeenCalledWith('dbpassword123', '127.0.0.1')
  })

  it.each(['192.168.1.10', '::1', '0.0.0.0'])(
    'rebuilds the client against the configured host %s regardless of enforcement',
    async (host) => {
      setOpenCodeEnv({ host, password: 'envpassword123' })
      context.harness.sandbox.enabled = true

      await context.harness.manager.rebuildClient()

      expect(context.harness.createOpenCodeClient).toHaveBeenCalledWith('envpassword123', host)
    },
  )
})

describe('OpenCodeServerManager - service mode and password delivery', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '0.0.0.0', password: '' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('generates a managed password for an exposed server and delivers it only through the service settings file', async () => {
    await context.harness.manager.start()

    const settings = await readServiceSettings()
    const managedPassword = new SettingsService(context.db).getOpenCodeServerPassword()
    expect(settings).toEqual({ password: managedPassword, mode: 0o600 })
    expect(managedPassword).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(context.harness.createOpenCodeClient).toHaveBeenCalledWith(managedPassword, '0.0.0.0')
    expect(context.harness.spawnEnv()).not.toHaveProperty('OPENCODE_SERVER_PASSWORD')
    expect(context.harness.spawnEnv()).not.toHaveProperty('OPENCODE_SERVER_USERNAME')
    expect(context.harness.manager.getLastStartupError()).toBeNull()
  })

  it('starts in service mode after clearing a stale service registration and persisting the password', async () => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    const registrationPath = serviceRegistrationPath(context.workspace.path)
    await mkdir(path.dirname(registrationPath), { recursive: true })
    await writeFile(registrationPath, JSON.stringify({ password: 'stale' }), 'utf-8')
    let registrationExistedAtSpawn = true
    context.harness.setChildFactory(() => {
      registrationExistedAtSpawn = existsSync(registrationPath)
      return new FakeServerChild()
    })

    await context.harness.manager.start()

    expect(context.harness.spawnArgs()).toEqual(['serve', '--service', '--port', '5551', '--hostname', '127.0.0.1'])
    expect(context.harness.spawnEnv().XDG_CONFIG_HOME).toBe(path.join(context.workspace.path, '.config'))
    expect(context.harness.spawnEnv().XDG_STATE_HOME).toBe(path.join(context.workspace.path, '.opencode', 'state'))
    expect(await readServiceSettings()).toEqual({ password: 'envpassword123', mode: 0o600 })
    expect(registrationExistedAtSpawn).toBe(false)
  })

  it('delivers only the managed password and drops inherited and user-supplied password env vars', async () => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    new SettingsService(context.db).updateSettings({
      serverEnvVars: [
        { key: 'OPENCODE_PASSWORD', value: 'user-stray-password' },
        { key: 'OPENCODE_SERVER_PASSWORD', value: 'user-server-password' },
      ],
    })
    const restoreEnv = applyTestEnv({ OPENCODE_PASSWORD: 'inherited-stray-password' })

    try {
      await context.harness.manager.start()
    } finally {
      restoreEnv()
    }

    expect(context.harness.spawnEnv()).not.toHaveProperty('OPENCODE_PASSWORD')
    expect(context.harness.spawnEnv()).not.toHaveProperty('OPENCODE_SERVER_PASSWORD')
    expect((await readServiceSettings()).password).toBe('envpassword123')
  })

  it('refuses to spawn when the service settings cannot be written', async () => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    const settingsPath = getOpenCodeServiceSettingsPath()
    await mkdir(settingsPath, { recursive: true })

    try {
      await expect(context.harness.manager.start()).rejects.toThrow('Failed to prepare the OpenCode service settings')
    } finally {
      await rm(settingsPath, { recursive: true, force: true })
    }

    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.getLastStartupError()).toContain('Failed to prepare the OpenCode service settings')
  })
})

describe('OpenCodeServerManager - child environment', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it.each([
    { enforced: false, flag: 'false' },
    { enforced: true, flag: 'true' },
  ])('stamps OCM_SANDBOX_ENFORCED=$flag when enforcement is $enforced', async ({ enforced, flag }) => {
    context.harness.sandbox.enabled = enforced
    context.harness.ownPortAfterSpawn()

    await context.harness.manager.start()

    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe(flag)
    expect(context.harness.spawnEnv().OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined()
    expect(context.harness.manager.isSandboxEnforced()).toBe(enforced)
  })

  it('keeps OCM_SANDBOX_ENFORCED manager-controlled despite a user-supplied entry', async () => {
    new SettingsService(context.db).updateSettings({
      serverEnvVars: [{ key: 'OCM_SANDBOX_ENFORCED', value: 'user-tampered' }],
    })

    await context.harness.manager.start()

    expect(context.harness.spawnEnv().OCM_SANDBOX_ENFORCED).toBe('false')
  })

  it('drops user-supplied MSB_* entries so the child runs the manager-owned microsandbox runtime', async () => {
    const restoreEnv = applyTestEnv({
      MSB_HOME: undefined,
      MSB_BACKEND: undefined,
      MSB_PATH: undefined,
      MSB_LIBKRUNFW_PATH: undefined,
      MSB_PROFILE: undefined,
      MSB_API_URL: undefined,
    })
    try {
      new SettingsService(context.db).updateSettings({
        serverEnvVars: [
          { key: 'MSB_HOME', value: '/evil/msb-home' },
          { key: 'MSB_BACKEND', value: 'cloud' },
          { key: 'MSB_PATH', value: '/evil/msb' },
          { key: 'MSB_LIBKRUNFW_PATH', value: '/evil/libkrunfw.so' },
          { key: 'MSB_PROFILE', value: 'tampered' },
          { key: 'MSB_API_URL', value: 'https://evil.example.com' },
        ],
      })

      await context.harness.manager.start()
    } finally {
      restoreEnv()
    }

    const env = context.harness.spawnEnv()
    expect(env.MSB_HOME).toBe(path.join(process.env.HOME ?? '', '.microsandbox'))
    expect(env.MSB_BACKEND).toBe('local')
    expect(env.MSB_PATH).toBe('msb')
    expect(env.MSB_LIBKRUNFW_PATH).toBeUndefined()
    expect(env.MSB_PROFILE).toBeUndefined()
    expect(env.MSB_API_URL).toBeUndefined()
  })

  it('stamps manager-owned microsandbox control variables over inherited and user-supplied values', async () => {
    const restoreEnv = applyTestEnv({
      MSB_HOME: '/opt/manager-msb-home',
      MSB_BACKEND: 'local',
      MSB_LIBKRUNFW_PATH: '/opt/manager/libkrunfw.so',
      MSB_PROFILE: 'manager-profile',
      MSB_API_URL: 'https://manager.example.com',
      MSB_API_KEY: 'manager-key',
    })
    try {
      new SettingsService(context.db).updateSettings({
        serverEnvVars: [
          { key: 'MSB_HOME', value: '/evil/msb-home' },
          { key: 'MSB_LIBKRUNFW_PATH', value: '/evil/libkrunfw.so' },
        ],
      })

      await context.harness.manager.start()
    } finally {
      restoreEnv()
    }

    const env = context.harness.spawnEnv()
    expect(env.MSB_HOME).toBe('/opt/manager-msb-home')
    expect(env.MSB_BACKEND).toBe('local')
    expect(env.MSB_LIBKRUNFW_PATH).toBe('/opt/manager/libkrunfw.so')
    expect(env.MSB_PROFILE).toBe('manager-profile')
    expect(env.MSB_API_URL).toBe('https://manager.example.com')
    expect(env.MSB_API_KEY).toBe('manager-key')
  })

  it('points TMPDIR at the workspace temp home and clears the agent temp directory before spawning', async () => {
    const agentTmpPath = path.join(context.workspace.path, '.opencode', 'tmp', 'opencode')
    await mkdir(path.join(agentTmpPath, 'stale-run'), { recursive: true })
    await writeFile(path.join(agentTmpPath, 'leftover.txt'), 'leftover', 'utf-8')

    await context.harness.manager.start()

    expect(context.harness.spawnEnv().TMPDIR).toBe(path.join(context.workspace.path, '.opencode', 'tmp'))
    expect(await readdir(agentTmpPath)).toEqual([])
  })

  it('passes the manager internal token to the child', async () => {
    await context.harness.manager.start()

    expect(context.harness.spawnEnv().OCM_INTERNAL_TOKEN).toBe(getOrCreateInternalToken(context.db))
    expect(context.harness.spawnEnv().OCM_INTERNAL_TOKEN).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    { source: 'user preferences', fromPreferences: true },
    { source: 'the inherited environment', fromPreferences: false },
  ])('drops OpenCode config source variables from $source', async ({ fromPreferences }) => {
    const keys = {
      OPENCODE_CONFIG: '/tmp/evil-config.json',
      OPENCODE_CONFIG_DIR: '/tmp/evil-config',
      OPENCODE_CONFIG_CONTENT: '{"plugin":["file:///evil.js"]}',
    }
    try {
      if (fromPreferences) {
        new SettingsService(context.db).updateSettings({
          serverEnvVars: Object.entries(keys).map(([key, value]) => ({ key, value })),
        })
      } else {
        for (const [key, value] of Object.entries(keys)) process.env[key] = value
      }

      await context.harness.manager.start()
    } finally {
      delete process.env.OPENCODE_CONFIG
      delete process.env.OPENCODE_CONFIG_DIR
      delete process.env.OPENCODE_CONFIG_CONTENT
    }

    const env = context.harness.spawnEnv()
    expect(env.OPENCODE_CONFIG).toBeUndefined()
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(env.XDG_CONFIG_HOME).toBe(path.join(context.workspace.path, '.config'))
  })

  it.each([
    { source: 'user preferences', fromPreferences: true },
    { source: 'the inherited environment', fromPreferences: false },
  ])('passes config-source and shell startup variables through from $source', async ({ fromPreferences }) => {
    const vars = {
      OPENCODE_AUTH_CONTENT: '{"https://evil.example.com":{"type":"wellknown","key":"K","token":"t"}}',
      OPENCODE_TEST_HOME: '/tmp/evil-home',
      OPENCODE_TEST_MANAGED_CONFIG_DIR: '/tmp/evil-managed',
      SHELL: '/workspace/repos/evil/evil-sh',
      BASH_ENV: '/workspace/repos/evil/rc',
      ENV: '/workspace/repos/evil/envrc',
      HOME: '/tmp/evil-user-home',
    } satisfies Record<string, string>
    const restoreEnv = applyTestEnv(
      fromPreferences ? {} : vars,
    )
    try {
      if (fromPreferences) {
        new SettingsService(context.db).updateSettings({
          serverEnvVars: Object.entries(vars).map(([key, value]) => ({ key, value })),
        })
      }

      await context.harness.manager.start()
    } finally {
      restoreEnv()
    }

    const env = context.harness.spawnEnv()
    for (const [key, value] of Object.entries(vars)) {
      expect(env[key]).toBe(value)
    }
  })

  it('spawns the verified OpenCode executable by absolute path', async () => {
    await context.harness.manager.start()

    expect(context.harness.spawnServer.mock.calls[0]?.[0]).toBe(context.executablePath)
  })

  it('prefers the user-installed OpenCode executable over a bundled one', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'ocm-opencode-home-'))
    const restoreEnv = applyTestEnv({ OPENCODE_BIN: undefined, HOME: home })
    try {
      const userBinary = path.join(home, '.opencode', 'bin', 'opencode')
      await mkdir(path.dirname(userBinary), { recursive: true })
      await writeFile(userBinary, '#!/bin/sh\nexit 0\n', { encoding: 'utf-8', mode: 0o755 })

      expect(resolveOpenCodeExecutable()).toBe(userBinary)
    } finally {
      restoreEnv()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('returns null for the executable when no candidate is runnable', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'ocm-opencode-home-'))
    const restoreEnv = applyTestEnv({ OPENCODE_BIN: path.join(home, 'missing-opencode'), HOME: home })
    try {
      expect(resolveOpenCodeExecutable()).toBeNull()
    } finally {
      restoreEnv()
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('OpenCodeServerManager - startup health', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('fails startup immediately with the exit reason when the child exits before becoming healthy', async () => {
    context.harness.health.mockRejectedValue(new Error('connection refused'))
    context.harness.setChildFactory(() => {
      const child = new FakeServerChild()
      queueMicrotask(() => child.exitChild(1))
      return child
    })

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode server exited with code 1')
    expect(context.harness.manager.getLastStartupError()).toBe('OpenCode server exited with code 1')
  })

  it('aborts an in-flight health probe and fails promptly when the child exits', async () => {
    let capturedSignal: AbortSignal | undefined
    const child = new FakeServerChild()
    context.harness.health.mockImplementation((options) => {
      capturedSignal = options?.signal ?? undefined
      queueMicrotask(() => child.exitChild(1))
      return new Promise<never>(() => undefined)
    })
    context.harness.setChildFactory(() => child)

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode server exited with code 1')
    expect(capturedSignal?.aborted).toBe(true)
    expect(context.harness.manager.getLastStartupError()).toBe('OpenCode server exited with code 1')
  }, 15000)

  it('marks the server healthy when a health probe succeeds while the child is still running', async () => {
    let capturedSignal: AbortSignal | undefined
    context.harness.health.mockImplementation(async (options) => {
      capturedSignal = options?.signal ?? undefined
      return DEFAULT_SERVER_INFO
    })

    await context.harness.manager.start()

    expect(context.harness.health).toHaveBeenCalledTimes(1)
    expect(capturedSignal?.aborted).toBe(false)
    expect(context.harness.manager.getLastStartupError()).toBeNull()
    expect(context.harness.manager.isServerHealthy()).toBe(true)
    expectLoggedMessage('OpenCode server is healthy')
  }, 15000)

  it('fails startup when the health probe only succeeds after the child has exited', async () => {
    let capturedSignal: AbortSignal | undefined
    const child = new FakeServerChild()
    context.harness.health.mockImplementation((options) => {
      capturedSignal = options?.signal ?? undefined
      queueMicrotask(() => child.exitChild(1))
      return new Promise((resolve) => {
        setTimeout(() => resolve(DEFAULT_SERVER_INFO), 0)
      })
    })
    context.harness.setChildFactory(() => child)

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode server exited with code 1')
    expect(capturedSignal?.aborted).toBe(true)
    expect(context.harness.manager.getLastStartupError()).toBe('OpenCode server exited with code 1')
  }, 15000)

  it('records a launch failure when the OpenCode executable cannot be spawned', async () => {
    context.harness.health.mockRejectedValue(new Error('connection refused'))
    context.harness.setChildFactory(() => {
      const child = new FakeServerChild()
      queueMicrotask(() => child.emitError(new Error('spawn opencode ENOENT')))
      return child
    })

    await expect(context.harness.manager.start()).rejects.toThrow('spawn opencode ENOENT')
    expect(context.harness.manager.getLastStartupError()).toMatch(/^Failed to launch the OpenCode server \(/)
    expect(context.harness.manager.getLastStartupError()).toContain('spawn opencode ENOENT')
  })
})

describe('OpenCodeServerManager - child stderr diagnostics', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  async function startWithStderr(options: { stdout?: PassThrough } = {}): Promise<FakeServerChild> {
    const child = new FakeServerChild(1234, { stderr: new PassThrough(), stdout: options.stdout })
    context.harness.setChildFactory(() => child)
    await context.harness.manager.start()
    return child
  }

  async function startServer(): Promise<FakeServerChild> {
    const child = new FakeServerChild()
    context.harness.setChildFactory(() => child)
    await context.harness.manager.start()
    return child
  }

  it('records child output that arrives after the exit event but before the stdio streams end', async () => {
    const stdout = new PassThrough()
    const child = await startWithStderr({ stdout })

    child.writeStderr('ERROR boom\npartial tail')
    child.exitChild(1)

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual(['ERROR boom'])

    child.writeStderr(' FINAL')
    child.endStderr()
    stdout.write('INFO started\n')
    stdout.end()

    await vi.waitFor(() => {
      const messages = readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)
      expect([...messages].sort()).toEqual(['ERROR boom', 'INFO started', 'partial tail FINAL'])
      expect(messages.filter((message) => message === 'partial tail FINAL')).toHaveLength(1)
    })
    expect(context.harness.manager.getServerPid()).toBeNull()
    await vi.waitFor(() => {
      expect(context.harness.manager.getLastStartupError()).toContain('exited with code 1')
      expect(context.harness.manager.getLastStartupError()).toContain('partial tail FINAL')
    })
  }, 15000)

  it('preserves a split multibyte UTF-8 character in the startup stderr diagnostic tail', async () => {
    const child = await startWithStderr()
    const encoded = Buffer.from('Fatal: café', 'utf8')
    const accentByteIndex = encoded.length - 1

    child.writeStderrBytes(encoded.subarray(0, accentByteIndex))
    child.writeStderrBytes(encoded.subarray(accentByteIndex))
    child.endStderr()
    child.exitChild(1)

    await vi.waitFor(() => {
      const startupError = context.harness.manager.getLastStartupError() ?? ''
      expect(startupError).toContain('Fatal: café')
      expect(startupError).not.toContain('\uFFFD')
    })
  }, 15000)

  it('flushes an incomplete multibyte sequence when the stderr stream ends', async () => {
    const child = await startWithStderr()

    child.writeStderrBytes(Buffer.from([0xc3]))
    child.endStderr()
    child.exitChild(1)

    await vi.waitFor(() => {
      expect(context.harness.manager.getLastStartupError()).toContain('\uFFFD')
    })
  }, 15000)

  it('includes stderr that arrives after a startup crash exit in the startup diagnostic', async () => {
    context.harness.health.mockRejectedValue(new Error('connection refused'))
    const child = new FakeServerChild(1234, { stderr: new PassThrough() })
    context.harness.setChildFactory(() => {
      queueMicrotask(() => {
        child.exitChild(1)
        child.writeStderr('late startup crash detail')
        child.endStderr()
      })
      return child
    })

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode server exited with code 1')
    expect(context.harness.manager.getLastStartupError()).toContain('late startup crash detail')
  }, 15000)

  it('finalizes the exit diagnostic after the drain bound when stderr never ends', async () => {
    const child = await startWithStderr()

    child.writeStderr('drain bound detail')
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      child.exitChild(1)
      expect(context.harness.manager.getLastStartupError()).toBeNull()

      await vi.advanceTimersByTimeAsync(1000)

      expect(context.harness.manager.getLastStartupError()).toContain('exited with code 1')
      expect(context.harness.manager.getLastStartupError()).toContain('drain bound detail')
    } finally {
      child.endStderr()
      vi.useRealTimers()
    }
  }, 15000)

  it('finalizes the exit diagnostic on child close when stderr never ends', async () => {
    context.harness.health.mockRejectedValue(new Error('connection refused'))
    const child = new FakeServerChild(1234, { stderr: new PassThrough() })
    context.harness.setChildFactory(() => {
      queueMicrotask(() => {
        child.exitChild(1)
        child.writeStderr('close fallback detail')
        child.emitClose()
      })
      return child
    })

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode server exited with code 1')
    expect(context.harness.manager.getLastStartupError()).toContain('close fallback detail')
  }, 15000)

  it('does not record a deliberate SIGTERM stop as a startup failure', async () => {
    const child = await startServer()

    await context.harness.manager.stop()
    child.exitChild(null, 'SIGTERM')

    expect(context.harness.manager.getLastStartupError()).toBeNull()
  }, 15000)

  it('records an unexpected SIGTERM exit as a startup failure', async () => {
    const child = await startServer()

    child.exitChild(null, 'SIGTERM')

    expect(context.harness.manager.getLastStartupError()).toContain('terminated by signal SIGTERM')
  }, 15000)

  it('records a nonzero exit even while the manager is deliberately stopping the child', async () => {
    const child = await startServer()

    await context.harness.manager.stop()
    child.exitChild(1)

    expect(context.harness.manager.getLastStartupError()).toContain('exited with code 1')
  }, 15000)
})

describe('OpenCodeServerManager - plugins and version', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('restores quarantined plugins and installs generated plugins into the manager config home', async () => {
    await context.harness.manager.start()

    const configHome = path.join(context.workspace.path, '.config')
    expect(context.harness.restoreQuarantinedOpenCodePlugins).toHaveBeenCalledWith(
      configHome,
      path.join(configHome, 'opencode', 'opencode.json'),
    )
    expect(context.harness.installManagedPlugins).toHaveBeenCalledWith(configHome)
  })

  it.each([
    { enforced: true, expected: 'aborts' },
    { enforced: false, expected: 'continues' },
  ])('$expected startup when generated plugins cannot be installed (enforced: $enforced)', async ({ enforced, expected }) => {
    context.harness.sandbox.enabled = enforced
    context.harness.ownPortAfterSpawn()
    context.harness.installManagedPlugins.mockRejectedValueOnce(new Error('readonly filesystem'))

    if (expected === 'aborts') {
      await expect(context.harness.manager.start()).rejects.toThrow('readonly filesystem')
      expect(context.harness.spawnServer).not.toHaveBeenCalled()
      return
    }
    await context.harness.manager.start()
    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('aborts startup when quarantined plugins cannot be restored (enforced: %s)', async (enforced) => {
    context.harness.sandbox.enabled = enforced
    context.harness.ownPortAfterSpawn()
    context.harness.restoreQuarantinedOpenCodePlugins.mockRejectedValueOnce(new Error('readonly filesystem'))

    await expect(context.harness.manager.start()).rejects.toThrow('readonly filesystem')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
  })

  it.each([true, false])('starts on a supported OpenCode 2 build (enforced: %s)', async (enforced) => {
    context.harness.sandbox.enabled = enforced
    context.harness.ownPortAfterSpawn()
    context.harness.readVersionOutput.mockReturnValue({ stdout: 'opencode v2.2.5\n', stderr: '' })

    await context.harness.manager.start()

    expect(context.harness.spawnServer).toHaveBeenCalledTimes(1)
    expect(context.harness.manager.getVersion()).toBe('2.2.5')
    expect(context.harness.manager.isVersionSupported()).toBe(true)
  })

  it('fails startup non-recoverably on an OpenCode 1.x build before spawning', async () => {
    context.harness.readVersionOutput.mockReturnValue({ stdout: 'opencode v1.18.32\n', stderr: '' })

    await expect(context.harness.manager.start()).rejects.toThrow('OpenCode 1.18.32 is not supported')
    expect(context.harness.spawnServer).not.toHaveBeenCalled()
    expect(context.harness.manager.getLastStartupError()).toContain('requires OpenCode >=2.2.5 <3.0.0')
    expect(context.harness.manager.isLastStartupErrorNonRecoverable()).toBe(true)
  })
})

describe('OpenCodeServerManager - restart and lifecycle', () => {
  let context: OpenCodeServerTestContext

  beforeEach(() => {
    setOpenCodeEnv({ host: '127.0.0.1', password: 'envpassword123' })
    context = createContext()
  })

  afterEach(() => {
    context.dispose()
    setOpenCodeEnv({ host: originalHost, password: originalPassword })
  })

  it('keeps a restart request that is marked during startup', async () => {
    let marked = false
    context.harness.health.mockImplementation(async () => {
      if (!marked) {
        marked = true
        context.harness.manager.markRestartPending()
      }
      return DEFAULT_SERVER_INFO
    })

    await context.harness.manager.start()

    expect(context.harness.manager.isRestartPending()).toBe(true)
  })

  it('clears a restart request when no newer change arrives during startup', async () => {
    context.harness.manager.markRestartPending()

    await context.harness.manager.start()

    expect(context.harness.manager.isRestartPending()).toBe(false)
  })

  it('rejects a concurrent restart and start instead of treating contention as success', async () => {
    const pendingStart = context.harness.manager.start()
    pendingStart.catch(() => undefined)

    await expect(context.harness.manager.restart()).rejects.toThrow('Another OpenCode server operation is already in progress')
    await expect(context.harness.manager.start()).rejects.toThrow('Another OpenCode server operation is already in progress')

    await pendingStart
    expect(context.harness.manager.isOperationInProgress()).toBe(false)
  })

  it('notifies lifecycle listeners only when the gate opens', () => {
    const manager = createOpenCodeServerHarness().manager
    const listener = vi.fn()
    const unsubscribe = manager.onLifecycleInitialized(listener)

    manager.setLifecycleInitialized(false)
    manager.setLifecycleInitialized(true)
    manager.setLifecycleInitialized(true)
    manager.setLifecycleInitialized(false)
    manager.setLifecycleInitialized(true)
    unsubscribe()
    manager.setLifecycleInitialized(false)
    manager.setLifecycleInitialized(true)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(manager.isLifecycleInitialized()).toBe(true)
  })
})

describe('ConfigReloadError', () => {
  it('carries startup validation issues', () => {
    const issues = [{ path: 'command.review', message: 'Invalid' }]
    const error = new ConfigReloadError('Test error', issues)

    expect(error.name).toBe('ConfigReloadError')
    expect(error.message).toBe('Test error')
    expect(error.validationIssues).toEqual(issues)
  })

  it('defaults to an empty issue list', () => {
    const error = new ConfigReloadError('Test error')

    expect(error.validationIssues).toEqual([])
  })
})

describe('OpenCodeServerManager - checkHealth', () => {
  const originalHealthTimeout = ENV.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS
  let manager: OpenCodeServerManager

  beforeEach(() => {
    Object.defineProperty(ENV.TIMEOUTS, 'HEALTH_CHECK_TIMEOUT_MS', { value: 50, configurable: true, writable: true })
    manager = createOpenCodeServerHarness().manager
  })

  afterEach(() => {
    Object.defineProperty(ENV.TIMEOUTS, 'HEALTH_CHECK_TIMEOUT_MS', {
      value: originalHealthTimeout,
      configurable: true,
      writable: true,
    })
  })

  it('probes the server info endpoint and reports healthy for a ServerInfo response', async () => {
    const info = vi.fn(async () => DEFAULT_SERVER_INFO)
    manager.setOpenCodeClient(createStubOpenCodeClient({ api: { server: { info } } }))

    await expect(manager.checkHealth()).resolves.toBe(true)

    expect(info).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
  })

  it('reports unhealthy when the info probe rejects', async () => {
    const info = vi.fn(async () => {
      throw new Error('Unauthorized')
    })
    manager.setOpenCodeClient(createStubOpenCodeClient({ api: { server: { info } } }))

    await expect(manager.checkHealth()).resolves.toBe(false)
  })

  it('reports unhealthy and aborts the probe when it times out', async () => {
    let aborted = false
    const info = vi.fn(async (options?: { signal?: AbortSignal }) => {
      return await new Promise<never>((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('Aborted'))
        })
      })
    })
    manager.setOpenCodeClient(createStubOpenCodeClient({ api: { server: { info } } }))

    await expect(manager.checkHealth()).resolves.toBe(false)
    expect(aborted).toBe(true)
  }, 5000)
})
