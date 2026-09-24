import { describe, it, expect, vi, beforeEach } from 'vitest'

const managerMock = vi.hoisted(() => ({
  getLastStartupError: vi.fn<() => string | null>(() => null),
  clearStartupError: vi.fn<() => void>(),
  restart: vi.fn<() => Promise<void>>(),
  checkHealth: vi.fn<() => Promise<boolean>>(),
}))

const configFileMock = vi.hoisted(() => ({
  readOpenCodeConfigFile: vi.fn(),
}))

const aggregatorMock = vi.hoisted(() => ({
  getActiveSessions: vi.fn<() => Record<string, string[]>>(() => ({})),
  isSubagentSession: vi.fn<(sessionId: string) => boolean>(() => false),
  getScheduledSessionIds: vi.fn<() => Set<string>>(() => new Set()),
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

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: aggregatorMock,
}))

import {
  listActiveUserSessions,
  reloadOpenCodeConfig,
  restartOpenCode,
} from '../../src/services/opencode-restart'
import type { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { OpenCodeClient } from '../../src/services/opencode/client'

function createSupervisor(healthy: boolean): OpenCodeSupervisor {
  return {
    restart: vi.fn().mockResolvedValue({ healthy }),
  } as unknown as OpenCodeSupervisor
}

function resetAggregator(): void {
  aggregatorMock.getActiveSessions.mockReset().mockReturnValue({})
  aggregatorMock.isSubagentSession.mockReset().mockReturnValue(false)
  aggregatorMock.getScheduledSessionIds.mockReset().mockReturnValue(new Set())
}

describe('listActiveUserSessions', () => {
  beforeEach(resetAggregator)

  it('returns every active session with its directory', () => {
    aggregatorMock.getActiveSessions.mockReturnValue({ '/a': ['s1', 's2'], '/b': ['s3'] })

    expect(listActiveUserSessions()).toEqual([
      { sessionID: 's1', directory: '/a' },
      { sessionID: 's2', directory: '/a' },
      { sessionID: 's3', directory: '/b' },
    ])
  })

  it('excludes subagent and scheduled sessions', () => {
    aggregatorMock.getActiveSessions.mockReturnValue({ '/a': ['manual', 'sub', 'sched'] })
    aggregatorMock.isSubagentSession.mockImplementation((id: string) => id === 'sub')
    aggregatorMock.getScheduledSessionIds.mockReturnValue(new Set(['sched']))

    expect(listActiveUserSessions()).toEqual([{ sessionID: 'manual', directory: '/a' }])
  })

  it('reads from an explicitly provided source', () => {
    const source = {
      getActiveSessions: () => ({ '/x': ['s9'] }),
      isSubagentSession: () => false,
      getScheduledSessionIds: () => new Set<string>(),
    }

    expect(listActiveUserSessions(source)).toEqual([{ sessionID: 's9', directory: '/x' }])
    expect(aggregatorMock.getActiveSessions).not.toHaveBeenCalled()
  })
})

describe('restartOpenCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAggregator()
    managerMock.getLastStartupError.mockReturnValue(null)
  })

  it('returns the user sessions that were active when the restart began', async () => {
    aggregatorMock.getActiveSessions.mockReturnValue({ '/a': ['session-1', 'sub-1'], '/b': ['session-2'] })
    aggregatorMock.isSubagentSession.mockImplementation((id: string) => id === 'sub-1')
    const supervisor = createSupervisor(true)
    vi.mocked(supervisor.restart).mockImplementation(async () => {
      aggregatorMock.getActiveSessions.mockReturnValue({})
      return { healthy: true } as Awaited<ReturnType<OpenCodeSupervisor['restart']>>
    })

    const result = await restartOpenCode(supervisor)

    expect(result).toEqual({ interruptedSessionIDs: ['session-1', 'session-2'] })
    expect(supervisor.restart).toHaveBeenCalledWith('settings_restart')
  })

  it('throws with the startup failure reason when the supervisor restart is unhealthy', async () => {
    managerMock.getLastStartupError.mockReturnValue('OpenCode server failed to become healthy')

    await expect(restartOpenCode(createSupervisor(false))).rejects.toThrow('OpenCode server failed to become healthy')
  })

  it('returns no interrupted sessions when nothing was active', async () => {
    const result = await restartOpenCode(createSupervisor(true))

    expect(result).toEqual({ interruptedSessionIDs: [] })
  })

  it('uses a generic failure message when no startup error is recorded', async () => {
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
  const locationReload = vi.fn<() => Promise<void>>()
  const openCodeClient = { api: { location: { reload: locationReload } } } as unknown as OpenCodeClient

  beforeEach(() => {
    vi.clearAllMocks()
    resetAggregator()
    locationReload.mockReset().mockResolvedValue(undefined)
    configFileMock.readOpenCodeConfigFile.mockReset()
  })

  it('throws a ConfigReloadError without reloading when every global source is absent', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue(null)

    await expect(reloadOpenCodeConfig(openCodeClient)).rejects.toMatchObject({
      name: 'ConfigReloadError',
      message: 'No OpenCode global configuration files found',
    })
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('throws a ConfigReloadError with validation issues without reloading when the config is invalid', async () => {
    const validationIssues = [{ path: 'model', message: 'Invalid model' }]
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: false, validationIssues })

    await expect(reloadOpenCodeConfig(openCodeClient)).rejects.toMatchObject({
      name: 'ConfigReloadError',
      message: 'OpenCode global configuration is invalid',
      validationIssues,
    })
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('reloads the OpenCode location for a valid config without restarting the server', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })

    await reloadOpenCodeConfig(openCodeClient)

    expect(locationReload).toHaveBeenCalledTimes(1)
    expect(managerMock.restart).not.toHaveBeenCalled()
  })

  it('propagates a location reload failure', async () => {
    configFileMock.readOpenCodeConfigFile.mockResolvedValue({ isValid: true })
    locationReload.mockRejectedValue(new Error('OpenCode server unavailable'))

    await expect(reloadOpenCodeConfig(openCodeClient)).rejects.toThrow('OpenCode server unavailable')
  })
})
