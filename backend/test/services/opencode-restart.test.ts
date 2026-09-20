import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const managerMock = vi.hoisted(() => ({
  getLastStartupError: vi.fn<() => string | null>(() => null),
  clearStartupError: vi.fn<() => void>(),
  restart: vi.fn<() => Promise<void>>(),
  reloadConfig: vi.fn<() => Promise<void>>(),
  checkHealth: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: managerMock,
}))

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
    reloadConfig: vi.fn().mockResolvedValue({ healthy }),
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
    runWithResume: vi.fn(async (reload: () => Promise<boolean>) => ({
      healthy: await reload(),
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
    managerMock.reloadConfig.mockReset()
    managerMock.checkHealth.mockReset()
    setOpenCodeRestartCoordinator(null)
  })

  afterEach(() => {
    setOpenCodeRestartCoordinator(null)
  })

  it('invokes the actual supervisor reload inside the coordinator wrapper', async () => {
    const supervisor = createSupervisor(true)
    const coordinator = createInvokingCoordinator(['session-1', 'session-2'])
    setOpenCodeRestartCoordinator(coordinator)

    await reloadOpenCodeConfig(supervisor)

    expect(coordinator.runWithResume).toHaveBeenCalledTimes(1)
    expect(supervisor.reloadConfig).toHaveBeenCalledWith('settings_reload')
  })

  it('invokes the actual manager reload inside the coordinator wrapper', async () => {
    managerMock.checkHealth.mockResolvedValue(true)
    const coordinator = createInvokingCoordinator()
    setOpenCodeRestartCoordinator(coordinator)

    await reloadOpenCodeConfig()

    expect(coordinator.runWithResume).toHaveBeenCalledTimes(1)
    expect(managerMock.reloadConfig).toHaveBeenCalledTimes(1)
    expect(managerMock.checkHealth).toHaveBeenCalled()
  })

  it('throws the reload failure when the coordinator reports an unhealthy reload', async () => {
    managerMock.getLastStartupError.mockReturnValue('OpenCode config reload failed')
    const supervisor = createSupervisor(true)
    setOpenCodeRestartCoordinator(createCoordinator(false))

    await expect(reloadOpenCodeConfig(supervisor)).rejects.toThrow('OpenCode config reload failed')
    expect(supervisor.reloadConfig).not.toHaveBeenCalled()
  })

  it('propagates a supervisor reload failure through the coordinator', async () => {
    const supervisor = createSupervisor(true)
    vi.mocked(supervisor.reloadConfig).mockRejectedValue(new Error('reload failed'))
    setOpenCodeRestartCoordinator(createInvokingCoordinator())

    await expect(reloadOpenCodeConfig(supervisor)).rejects.toThrow('reload failed')
  })

  it('propagates a manager reload validation failure through the coordinator', async () => {
    managerMock.reloadConfig.mockRejectedValue(new Error('OpenCode global configuration is invalid'))
    setOpenCodeRestartCoordinator(createInvokingCoordinator())

    await expect(reloadOpenCodeConfig()).rejects.toThrow('OpenCode global configuration is invalid')
  })

  it('reloads the supervisor directly without a coordinator', async () => {
    const supervisor = createSupervisor(true)

    await reloadOpenCodeConfig(supervisor)

    expect(supervisor.reloadConfig).toHaveBeenCalledWith('settings_reload')
  })

  it('throws when the manager reload leaves the server unhealthy without a coordinator', async () => {
    managerMock.checkHealth.mockResolvedValue(false)
    managerMock.getLastStartupError.mockReturnValue('reload did not restore health')

    await expect(reloadOpenCodeConfig()).rejects.toThrow('reload did not restore health')
  })
})
