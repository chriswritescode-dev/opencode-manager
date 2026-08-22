import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDirectoryExists, writeFileContent } from '../../src/services/file-operations'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  ensureDirectoryExists: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/tmp/opencode-workspace'),
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/opencode-workspace/.config/opencode.json'),
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
  reloadConfig: ReturnType<typeof vi.fn>
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
  archiveBrokenConfig: ReturnType<typeof vi.fn>
  restoreToLastKnownGoodConfig: ReturnType<typeof vi.fn>
  getDefaultOpenCodeConfig: ReturnType<typeof vi.fn>
  updateOpenCodeConfig: ReturnType<typeof vi.fn>
  createOpenCodeConfig: ReturnType<typeof vi.fn>
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
    reloadConfig: vi.fn().mockResolvedValue(undefined),
    clearStartupError: vi.fn(),
    getLastStartupError: vi.fn(() => null),
    isLastStartupErrorNonRecoverable: vi.fn(() => false),
    setLifecycleInitialized: vi.fn(),
    getPort: vi.fn(() => 5551),
    getVersion: vi.fn(() => '1.0.137'),
    getMinVersion: vi.fn(() => '1.0.137'),
    isVersionSupported: vi.fn(() => true),
  })

  const createSettings = (): FakeSettingsService => ({
    archiveBrokenConfig: vi.fn(() => 'default-broken-2026-01-01'),
    restoreToLastKnownGoodConfig: vi.fn(() => ({
      configName: 'default',
      content: '{"$schema":"https://opencode.ai/config.json"}',
    })),
    getDefaultOpenCodeConfig: vi.fn(() => ({
      name: 'default',
      content: { $schema: 'https://opencode.ai/config.json' },
      rawContent: '{"$schema":"https://opencode.ai/config.json"}',
      isDefault: true,
    })),
    updateOpenCodeConfig: vi.fn(() => ({
      name: 'default',
      content: { $schema: 'https://opencode.ai/config.json' },
      rawContent: '{"$schema":"https://opencode.ai/config.json"}',
      isDefault: true,
    })),
    createOpenCodeConfig: vi.fn(),
  })

  it('recovers a startup failure through rollback and keeps watching', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      userId: 'default',
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
    expect(settings.archiveBrokenConfig).toHaveBeenCalledWith('default')
    expect(settings.restoreToLastKnownGoodConfig).toHaveBeenCalledWith('default')
    expect(settings.updateOpenCodeConfig).toHaveBeenCalledWith(
      'default',
      { content: '{"$schema":"https://opencode.ai/config.json"}' },
      'default',
    )
    expect(writeFileContent).toHaveBeenCalledWith(
      '/tmp/opencode-workspace/.config/opencode.json',
      '{"$schema":"https://opencode.ai/config.json"}',
    )
    expect(status.watching).toBe(true)

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
      userId: 'default',
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
      userId: 'default',
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
    expect(ensureDirectoryExists).toHaveBeenCalled()
    expect(writeFileContent).toHaveBeenCalled()
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
      userId: 'default',
    })

    manager.start.mockRejectedValueOnce(new Error('OpenCode version 1.18.15 does not support sandboxed bash tool rewriting'))
    manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

    const status = await supervisor.start()

    expect(status.state).toBe('failed')
    expect(status.healthy).toBe(false)
    expect(status.lastError).toContain('does not support sandboxed bash tool rewriting')
    expect(manager.restart).not.toHaveBeenCalled()
    expect(settings.archiveBrokenConfig).not.toHaveBeenCalled()
    expect(settings.restoreToLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(settings.updateOpenCodeConfig).not.toHaveBeenCalled()
    expect(settings.createOpenCodeConfig).not.toHaveBeenCalled()
    expect(writeFileContent).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('does not run configuration recovery when a manual restart fails non-recoverably', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      userId: 'default',
    })

    manager.restart.mockRejectedValueOnce(new Error('Failed to quarantine untrusted OpenCode plugins'))
    manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

    const status = await supervisor.restart('settings_restart')

    expect(status.state).toBe('failed')
    expect(settings.archiveBrokenConfig).not.toHaveBeenCalled()
    expect(settings.restoreToLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(settings.updateOpenCodeConfig).not.toHaveBeenCalled()
    expect(settings.createOpenCodeConfig).not.toHaveBeenCalled()
    expect(writeFileContent).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('stops the recovery ladder when a recovery restart fails non-recoverably', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      userId: 'default',
    })

    manager.start.mockRejectedValueOnce(new Error('startup failed'))
    manager.checkHealth.mockResolvedValue(false)
    manager.restart.mockImplementation(async () => {
      manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)
      throw new Error('Failed to install the sandbox OpenCode plugin')
    })

    const status = await supervisor.start()

    expect(status.state).toBe('failed')
    expect(status.lastError).toContain('Failed to install the sandbox OpenCode plugin')
    expect(manager.restart).toHaveBeenCalledTimes(1)
    expect(settings.archiveBrokenConfig).not.toHaveBeenCalled()
    expect(settings.restoreToLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(settings.updateOpenCodeConfig).not.toHaveBeenCalled()
    expect(settings.createOpenCodeConfig).not.toHaveBeenCalled()
    expect(writeFileContent).not.toHaveBeenCalled()

    await supervisor.stop()
  })

  it('still follows the normal recovery ladder for a recoverable startup failure', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      userId: 'default',
    })

    manager.start.mockRejectedValueOnce(new Error('OpenCode config validation failed: command.review: Invalid'))
    manager.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const status = await supervisor.start()

    expect(status.state).toBe('healthy')
    expect(settings.archiveBrokenConfig).toHaveBeenCalledWith('default')
    expect(settings.restoreToLastKnownGoodConfig).toHaveBeenCalledWith('default')
    expect(settings.updateOpenCodeConfig).toHaveBeenCalled()
    expect(writeFileContent).toHaveBeenCalled()

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

  it('executes a reload requested during an active reload after the active reload completes', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    let releaseReload!: () => void
    manager.reloadConfig.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseReload = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const first = supervisor.reloadConfig('settings_reload')
    await vi.waitFor(() => expect(manager.reloadConfig).toHaveBeenCalledTimes(1))

    const second = supervisor.reloadConfig('manual')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.reloadConfig).toHaveBeenCalledTimes(1)

    releaseReload()

    const [firstStatus, secondStatus] = await Promise.all([first, second])

    expect(manager.reloadConfig).toHaveBeenCalledTimes(2)
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

  it('keeps the proxy lifecycle gate open across a config reload so in-flight sessions are never interrupted', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 1,
      watchEnabled: false,
    })

    await supervisor.start()
    expect(manager.setLifecycleInitialized).toHaveBeenLastCalledWith(true)
    manager.setLifecycleInitialized.mockClear()

    let releaseReload!: () => void
    manager.reloadConfig.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseReload = resolve }),
    )
    manager.checkHealth.mockResolvedValue(true)

    const reload = supervisor.reloadConfig('settings_reload')
    await vi.waitFor(() => expect(manager.reloadConfig).toHaveBeenCalledTimes(1))
    expect(manager.setLifecycleInitialized).not.toHaveBeenCalledWith(false)

    releaseReload()
    const status = await reload

    expect(status.healthy).toBe(true)
    expect(manager.setLifecycleInitialized).not.toHaveBeenCalledWith(false)
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
      userId: 'default',
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
