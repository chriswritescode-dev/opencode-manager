import { beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveBrokenOpenCodeConfigFile, writeHealthWatchArtifact, restoreOpenCodeConfigSnapshot, OPENCODE_CONFIG_SEED } from '../../src/services/opencode-config-file'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/services/opencode-config-file', () => {
  const seed = '{"$schema":"https://opencode.ai/config.json"}'
  return {
    archiveBrokenOpenCodeConfigFile: vi.fn(),
    writeHealthWatchArtifact: vi.fn(),
    restoreOpenCodeConfigSnapshot: vi.fn(async () => ({ isValid: true })),
    serializeOpenCodeConfigSnapshot: vi.fn(() => seed),
    buildOpenCodeConfigSeedSnapshot: vi.fn(() => seed),
    withOpenCodeConfigLock: (fn: () => Promise<unknown>) => fn(),
    OPENCODE_CONFIG_SEED: seed,
  }
})

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  TIMEOUTS: {},
  ENV: {
    OPENCODE: {
      HEALTH_POLL_MS: 200,
      HEALTH_FAILURE_THRESHOLD: 2,
      HEALTH_WATCH_ENABLED: true,
    },
  },
}))

interface FakeManager {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isOperationInProgress: ReturnType<typeof vi.fn>
  checkHealth: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
  clearStartupError: ReturnType<typeof vi.fn>
  getLastStartupError: ReturnType<typeof vi.fn>
  isLastStartupErrorNonRecoverable: ReturnType<typeof vi.fn>
  setLifecycleInitialized: ReturnType<typeof vi.fn>
  getPort: ReturnType<typeof vi.fn>
  getVersion: ReturnType<typeof vi.fn>
  getMinVersion: ReturnType<typeof vi.fn>
  isVersionSupported: ReturnType<typeof vi.fn>
}

interface FakeSettingsService {
  getLastKnownGoodConfig: ReturnType<typeof vi.fn>
}

describe('OpenCodeSupervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createManager = (): FakeManager => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isOperationInProgress: vi.fn(() => false),
    checkHealth: vi.fn().mockResolvedValue(true),
    restart: vi.fn().mockResolvedValue(undefined),
    clearStartupError: vi.fn(),
    getLastStartupError: vi.fn(() => null),
    isLastStartupErrorNonRecoverable: vi.fn(() => false),
    setLifecycleInitialized: vi.fn(),
    getPort: vi.fn(() => 5551),
    getVersion: vi.fn(() => '2.0.15'),
    getMinVersion: vi.fn(() => '2.0.15'),
    isVersionSupported: vi.fn(() => true),
  })

  const createSettings = (): FakeSettingsService => ({
    getLastKnownGoodConfig: vi.fn(() => '{"$schema":"https://opencode.ai/config.json"}'),
  })

  it('recovers a startup failure through rollback and keeps watching', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
    })

    manager.start.mockRejectedValueOnce(new Error('startup failed'))
    manager.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const status = await supervisor.start()

    expect(status.healthy).toBe(true)
    expect(status.state).toBe('healthy')
    expect(manager.restart).toHaveBeenCalledTimes(3)
    expect(settings.getLastKnownGoodConfig).toHaveBeenCalled()
    expect(archiveBrokenOpenCodeConfigFile).toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"$schema":"https://opencode.ai/config.json"}')
    expect(status.watching).toBe(true)

    await supervisor.stop()
  })

  it('seeds the default config when the recovery ladder reaches the seed action', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    manager.start.mockRejectedValueOnce(new Error('startup failed'))
    manager.checkHealth.mockResolvedValue(false)

    const status = await supervisor.start()

    expect(status.state).toBe('failed')
    expect(archiveBrokenOpenCodeConfigFile).toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).toHaveBeenCalledWith(OPENCODE_CONFIG_SEED)

    await supervisor.stop()
  })

  it('opens the proxy lifecycle gate when the managed child is attested healthy', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    await supervisor.start()

    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)
  })

  it('keeps the proxy lifecycle gate closed when startup fails non-recoverably', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    manager.start.mockRejectedValueOnce(new Error('OpenCode version 1.18.15 does not support sandboxed bash tool rewriting'))
    manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

    const status = await supervisor.start()

    expect(status.healthy).toBe(false)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)
  })

  it('closes the proxy lifecycle gate when recovery is exhausted and reopens it once health returns', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    manager.start.mockRejectedValueOnce(new Error('startup failed'))
    manager.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const failed = await supervisor.start()
    expect(failed.healthy).toBe(false)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)

    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)

    await supervisor.stop()
  })

  it('does not recover polling failures until the threshold is reached', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 2,
      watchEnabled: false,
    })

    manager.checkHealth.mockResolvedValueOnce(false)

    const status = await supervisor.checkNow('manual')

    expect(status.state).toBe('unhealthy')
    expect(status.failureCount).toBe(1)
    expect(manager.restart).not.toHaveBeenCalled()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)
  })

  it('closes the proxy lifecycle gate on a below-threshold health failure and reopens it once health returns', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 2,
      watchEnabled: false,
    })

    await supervisor.start()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)

    manager.checkHealth.mockResolvedValueOnce(false)

    const unhealthy = await supervisor.checkNow('manual')

    expect(unhealthy.state).toBe('unhealthy')
    expect(unhealthy.failureCount).toBe(1)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)
    expect(manager.restart).not.toHaveBeenCalled()

    manager.checkHealth.mockResolvedValueOnce(true)

    const recovered = await supervisor.checkNow('manual')

    expect(recovered.healthy).toBe(true)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)
  })

  it('captures debug state before debug recovery', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    manager.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const status = await supervisor.checkNow('manual')

    expect(status.healthy).toBe(true)
    expect(writeHealthWatchArtifact).toHaveBeenCalled()
    expect(manager.restart).toHaveBeenCalledTimes(2)
  })

  it('skips checks while OpenCode manager is busy', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never)

    manager.isOperationInProgress.mockReturnValue(true)

    await supervisor.checkNow('manual')

    expect(manager.checkHealth).not.toHaveBeenCalled()
  })

  it('does not run configuration recovery for a non-recoverable startup failure', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
    })

    manager.start.mockRejectedValueOnce(new Error('OpenCode version 1.18.15 does not support sandboxed bash tool rewriting'))
    manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

    const status = await supervisor.start()

    expect(status.state).toBe('failed')
    expect(status.healthy).toBe(false)
    expect(status.lastError).toContain('does not support sandboxed bash tool rewriting')
    expect(manager.restart).not.toHaveBeenCalled()
    expect(archiveBrokenOpenCodeConfigFile).not.toHaveBeenCalled()
    expect(settings.getLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).not.toHaveBeenCalled()
    expect(writeHealthWatchArtifact).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('does not run configuration recovery when a manual restart fails non-recoverably', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
    })

    manager.restart.mockRejectedValueOnce(new Error('Failed to install a generated OpenCode plugin; refusing to start an enforced server'))
    manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

    const status = await supervisor.restart('settings_restart')

    expect(status.state).toBe('failed')
    expect(archiveBrokenOpenCodeConfigFile).not.toHaveBeenCalled()
    expect(settings.getLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).not.toHaveBeenCalled()
    expect(writeHealthWatchArtifact).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('stops the recovery ladder when a recovery restart fails non-recoverably', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
    })

    manager.start.mockRejectedValueOnce(new Error('startup failed'))
    manager.checkHealth.mockResolvedValue(false)
    manager.restart.mockImplementation(async () => {
      manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)
      throw new Error('Failed to install a generated OpenCode plugin; refusing to start an enforced server')
    })

    const status = await supervisor.start()

    expect(status.state).toBe('failed')
    expect(status.lastError).toContain('Failed to install a generated OpenCode plugin')
    expect(manager.restart).toHaveBeenCalledTimes(1)
    expect(archiveBrokenOpenCodeConfigFile).not.toHaveBeenCalled()
    expect(settings.getLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).not.toHaveBeenCalled()
    expect(writeHealthWatchArtifact).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('still follows the normal recovery ladder for a recoverable startup failure', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
    })

    manager.start.mockRejectedValueOnce(new Error('OpenCode config validation failed: command.review: Invalid'))
    manager.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const status = await supervisor.start()

    expect(status.state).toBe('healthy')
    expect(archiveBrokenOpenCodeConfigFile).toHaveBeenCalled()
    expect(settings.getLastKnownGoodConfig).toHaveBeenCalled()
    expect(restoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"$schema":"https://opencode.ai/config.json"}')

    await supervisor.stop()
  })

  it('executes a restart requested during an active restart after the active restart completes', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    let releaseRestart!: () => void
    manager.restart.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseRestart = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const first = supervisor.restart('settings_restart')
    await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))

    const second = supervisor.restart('manual')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.restart).toHaveBeenCalledTimes(1)

    releaseRestart()

    const [firstStatus, secondStatus] = await Promise.all([first, second])

    expect(manager.restart).toHaveBeenCalledTimes(2)
    expect(firstStatus.healthy).toBe(true)
    expect(secondStatus.healthy).toBe(true)
  })

  it('closes the proxy lifecycle gate for the whole restart transition and reopens once healthy', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    await supervisor.start()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)

    let releaseRestart!: () => void
    manager.restart.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseRestart = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const restart = supervisor.restart('settings_restart')
    await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)

    releaseRestart()
    const status = await restart

    expect(status.healthy).toBe(true)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)
  })

  it('closes the proxy lifecycle gate while stopping and never reopens it', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    await supervisor.start()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)

    let releaseStop!: () => void
    manager.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStop = resolve }),
    )

    const stopPromise = supervisor.stop()
    await vi.waitFor(() => expect(manager.stop).toHaveBeenCalledTimes(1))
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)

    releaseStop()
    await stopPromise
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)
  })

  it('closes the proxy lifecycle gate while recovering a polling failure until health returns', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    await supervisor.start()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)

    let releaseRestart!: () => void
    manager.restart.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseRestart = resolve }),
    )
    manager.checkHealth.mockResolvedValueOnce(false)

    const recovering = supervisor.checkNow('manual')
    await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(false)

    releaseRestart()
    const status = await recovering

    expect(status.healthy).toBe(true)
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)
  })

  it('executes a stop requested during an active restart after the restart completes', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    let releaseRestart!: () => void
    manager.restart.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseRestart = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const restart = supervisor.restart('manual')
    await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))

    const stopPromise = supervisor.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.stop).not.toHaveBeenCalled()

    releaseRestart()

    await Promise.all([restart, stopPromise])

    expect(manager.restart).toHaveBeenCalledTimes(1)
    expect(manager.stop).toHaveBeenCalledTimes(1)
  })

  it('drops a restart stacked behind an already queued restart but never drops a stop', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    let releaseRestart!: () => void
    manager.restart.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseRestart = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const running = supervisor.restart('manual')
    await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))

    const queued = supervisor.restart('manual')
    const dropped = supervisor.restart('manual')
    const stopPromise = supervisor.stop()

    await expect(dropped).resolves.toMatchObject({ state: 'starting' })

    releaseRestart()
    await Promise.all([running, queued, stopPromise])

    expect(manager.restart).toHaveBeenCalledTimes(2)
    expect(manager.stop).toHaveBeenCalledTimes(1)
  })
})
