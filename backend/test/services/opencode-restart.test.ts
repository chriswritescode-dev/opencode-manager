import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const managerMock = vi.hoisted(() => ({
  getLastStartupError: vi.fn<() => string | null>(() => null),
  clearStartupError: vi.fn<() => void>(),
  restart: vi.fn<() => Promise<void>>(),
  checkHealth: vi.fn<() => Promise<boolean>>(),
}))

const configFileMock = vi.hoisted(() => ({
  readOpenCodeConfigFile: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: managerMock,
  ConfigReloadError: class ConfigReloadError extends Error {
    validationIssues: Array<{ path: string; message: string }>

    constructor(message: string, validationIssues: Array<{ path: string; message: string }> = []) {
      super(message)
      this.name = 'ConfigReloadError'
      this.validationIssues = validationIssues
    }
  },
}))

vi.mock('../../src/services/opencode-config-file', () => configFileMock)

import {
  reloadOpenCodeConfig,
  restartOpenCode,
  setOpenCodeRestartCoordinator,
} from '../../src/services/opencode-restart'
import type { OpenCodeRestartCoordinator } from '../../src/services/opencode-restart-coordinator'
import type { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

function createSupervisor(healthy: boolean): OpenCodeSupervisor {
  return {
    restart: vi.fn().mockResolvedValue({ healthy }),
  } as unknown as OpenCodeSupervisor
}

function createCoordinator(healthy: boolean, resumedSessionIDs: string[] = []): OpenCodeRestartCoordinator {
  return {
    runWithResume: vi.fn(async (restart: () => Promise<boolean>) => ({
      healthy: healthy ?? (await restart()),
      resumedSessionIDs,
    })),
  } as unknown as OpenCodeRestartCoordinator
}

function createInvokingCoordinator(resumedSessionIDs: string[] = []): OpenCodeRestartCoordinator {
  return {
    runWithResume: vi.fn(async (restart: () => Promise<boolean>) => ({
      healthy: await restart(),
      resumedSessionIDs,
    })),
  } as unknown as OpenCodeRestartCoordinator
}

describe('restartOpenCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenCodeRestartCoordinator(null)
  })

  afterEach(() => {
    setOpenCodeRestartCoordinator(null)
  })

  it('throws with the startup failure reason when the coordinator reports an unhealthy restart', async () => {
    managerMock.getLastStartupError.mockReturnValue('OpenCode version 1.18.15 does not support sandboxed bash tool rewriting')
    setOpenCodeRestartCoordinator(createCoordinator(false))

    await expect(restartOpenCode(createSupervisor(true))).rejects.toThrow(
      'OpenCode version 1.18.15 does not support sandboxed bash tool rewriting',
    )
  })

  it('preserves resumed session IDs only when the coordinator reports a healthy restart', async () => {
    setOpenCodeRestartCoordinator(createCoordinator(true, ['session-1', 'session-2']))

    const result = await restartOpenCode(createSupervisor(true))

    expect(result).toEqual({ resumedSessionIDs: ['session-1', 'session-2'] })
  })

  it('throws with the startup failure reason when the supervisor restart is unhealthy without a coordinator', async () => {
    managerMock.getLastStartupError.mockReturnValue('OpenCode server failed to become healthy')

    await expect(restartOpenCode(createSupervisor(false))).rejects.toThrow('OpenCode server failed to become healthy')
  })

  it('returns without resumed sessions when the supervisor restart is healthy without a coordinator', async () => {
    const supervisor = createSupervisor(true)

    const result = await restartOpenCode(supervisor)

    expect(result).toEqual({ resumedSessionIDs: [] })
    expect(supervisor.restart).toHaveBeenCalledWith('settings_restart')
  })

  it('uses a generic failure message when no startup error is recorded', async () => {
    managerMock.getLastStartupError.mockReturnValue(null)

    await expect(restartOpenCode(createSupervisor(false))).rejects.toThrow(
      'OpenCode server restart did not complete successfully',
    )
  })

  it('propagates a manager restart failure when no supervisor is provided', async () => {
    managerMock.restart.mockRejectedValue(new Error('server failed to become healthy'))

    await expect(restartOpenCode()).rejects.toThrow('server failed to become healthy')
    expect(managerMock.clearStartupError).toHaveBeenCalled()
  })
})

describe('reloadOpenCodeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    managerMock.getLastStartupError.mockReset().mockReturnValue(null)
    managerMock.clearStartupError.mockReset()
    managerMock.restart.mockReset()
    managerMock.checkHealth.mockReset()
    configFileMock.readOpenCodeConfigFile.mockReset()
    setOpenCodeRestartCoordinator(null)
  })

  afterEach(() => {
    setOpenCodeRestartCoordinator(null)
  })

  it('throws a ConfigReloadError without restarting when every global source is absent', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue(null)
    const supervisor = createSupervisor(true)

    await expect(reloadOpenCodeConfig(supervisor)).rejects.toMatchObject({
      name: 'ConfigReloadError',
      message: 'No OpenCode global configuration files found',
    })
    expect(supervisor.restart).not.toHaveBeenCalled()
    expect(managerMock.restart).not.toHaveBeenCalled()
  })

  it('throws a ConfigReloadError with validation issues without restarting when the config is invalid', async () => {
    const validationIssues = [{ path: 'model', message: 'Invalid model' }]
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: false, validationIssues })
    const supervisor = createSupervisor(true)

    await expect(reloadOpenCodeConfig(supervisor)).rejects.toMatchObject({
      name: 'ConfigReloadError',
      message: 'OpenCode global configuration is invalid',
      validationIssues,
    })
    expect(supervisor.restart).not.toHaveBeenCalled()
    expect(managerMock.restart).not.toHaveBeenCalled()
  })

  it('delegates a valid config to the supervisor restart path with the settings_reload reason', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })
    const supervisor = createSupervisor(true)

    const result = await reloadOpenCodeConfig(supervisor)

    expect(supervisor.restart).toHaveBeenCalledWith('settings_reload')
    expect(result).toEqual({ resumedSessionIDs: [] })
  })

  it('returns the resumed session IDs produced by the coordinator on a valid reload', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })
    const supervisor = createSupervisor(true)
    setOpenCodeRestartCoordinator(createInvokingCoordinator(['session-1', 'session-2']))

    const result = await reloadOpenCodeConfig(supervisor)

    expect(supervisor.restart).toHaveBeenCalledWith('settings_reload')
    expect(result).toEqual({ resumedSessionIDs: ['session-1', 'session-2'] })
  })

  it('restarts the manager directly without a coordinator', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })
    managerMock.checkHealth.mockResolvedValue(true)

    await reloadOpenCodeConfig()

    expect(managerMock.clearStartupError).toHaveBeenCalled()
    expect(managerMock.restart).toHaveBeenCalledTimes(1)
    expect(managerMock.checkHealth).toHaveBeenCalled()
  })

  it('throws when the manager restart leaves the server unhealthy without a coordinator', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })
    managerMock.checkHealth.mockResolvedValue(false)
    managerMock.getLastStartupError.mockReturnValue('reload did not restore health')

    await expect(reloadOpenCodeConfig()).rejects.toThrow('reload did not restore health')
  })
})
