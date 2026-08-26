import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const managerMock = vi.hoisted(() => ({
  getLastStartupError: vi.fn<() => string | null>(() => null),
  clearStartupError: vi.fn<() => void>(),
  restart: vi.fn<() => Promise<void>>(),
  checkHealth: vi.fn<() => boolean>(() => true),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: managerMock,
}))

import {
  restartOpenCode,
  restartOpenCodeAfterCommit,
  setOpenCodeRestartCoordinator,
} from '../../src/services/opencode-restart'
import type { OpenCodeRestartCoordinator } from '../../src/services/opencode-restart-coordinator'
import type { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

function createSupervisor(healthy: boolean): OpenCodeSupervisor {
  return {
    restart: vi.fn().mockResolvedValue({ healthy }),
    reloadConfig: vi.fn(),
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

describe('restartOpenCodeAfterCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenCodeRestartCoordinator(null)
  })

  afterEach(() => {
    setOpenCodeRestartCoordinator(null)
  })

  it('reports success without a restart error when the restart completes', async () => {
    managerMock.checkHealth.mockReturnValue(true)

    await expect(restartOpenCodeAfterCommit(createSupervisor(true))).resolves.toEqual({ restartFailed: false })
  })

  it('reports the failure instead of throwing so the caller can still return the persisted entity', async () => {
    managerMock.getLastStartupError.mockReturnValue('OpenCode health check failed')

    const result = await restartOpenCodeAfterCommit(createSupervisor(false))

    expect(result.restartFailed).toBe(true)
    expect(result.restartError).toBe('OpenCode health check failed')
  })
})
