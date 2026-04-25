import { describe, expect, it, vi } from 'vitest'
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
  const createManager = (): FakeManager => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isOperationInProgress: vi.fn(() => false),
    checkHealth: vi.fn().mockResolvedValue(true),
    restart: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
    clearStartupError: vi.fn(),
    getLastStartupError: vi.fn(() => null),
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

  it('does not recover polling failures until the threshold is reached', async () => {
    const manager = createManager()
    const settings = createSettings()
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, settings as unknown as never, {
      failureThreshold: 2,
      watchEnabled: false,
    })

    manager.checkHealth.mockResolvedValueOnce(false)

    const status = await supervisor.checkNow('api_probe')

    expect(status.state).toBe('unhealthy')
    expect(status.failureCount).toBe(1)
    expect(manager.restart).not.toHaveBeenCalled()
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

    const status = await supervisor.checkNow('api_probe')

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

    await supervisor.checkNow('api_probe')

    expect(manager.checkHealth).not.toHaveBeenCalled()
  })
})
