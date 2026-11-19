import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getOpenCodeConfigFilePath } from '@opencode-manager/shared/config/env'
import type { OpenCodeApi, OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { ConfigReloadError } from '../../src/services/opencode-single-server'
import { writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import {
  listActiveUserSessions,
  reloadOpenCodeConfig,
  restartOpenCode,
  type ActiveSessionsSource,
  type OpenCodeManagerProcess,
  type OpenCodeRestartTarget,
} from '../../src/services/opencode-restart'

function lifecycleStatus(healthy: boolean, lastError: string | null = healthy ? null : 'OpenCode server failed to become healthy'): OpenCodeLifecycleStatus {
  return {
    state: healthy ? 'healthy' : 'failed',
    healthy,
    port: 5551,
    version: '2.0.15',
    minVersion: '2.0.15',
    versionSupported: true,
    lastError,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: healthy ? 0 : 1,
    watching: false,
    updatedAt: new Date(0).toISOString(),
  }
}

function createSupervisor(healthy: boolean, lastError: string | null = healthy ? null : 'OpenCode server failed to become healthy'): OpenCodeRestartTarget {
  return { restart: vi.fn<OpenCodeRestartTarget['restart']>(async () => lifecycleStatus(healthy, lastError)) }
}

function createManager(): OpenCodeManagerProcess {
  return {
    clearStartupError: vi.fn<OpenCodeManagerProcess['clearStartupError']>(),
    restart: vi.fn<OpenCodeManagerProcess['restart']>(async () => undefined),
    checkHealth: vi.fn<OpenCodeManagerProcess['checkHealth']>(async () => true),
    getLastStartupError: vi.fn<OpenCodeManagerProcess['getLastStartupError']>(() => null),
  }
}

function createSessionsSource(): ActiveSessionsSource {
  return {
    getActiveSessions: vi.fn<ActiveSessionsSource['getActiveSessions']>(() => ({})),
    isSubagentSession: vi.fn<ActiveSessionsSource['isSubagentSession']>(() => false),
    getScheduledSessionIds: vi.fn<ActiveSessionsSource['getScheduledSessionIds']>(() => new Set()),
  }
}

describe('listActiveUserSessions', () => {
  it('returns every active session with its directory', () => {
    const source = createSessionsSource()
    vi.mocked(source.getActiveSessions).mockReturnValue({ '/a': ['s1', 's2'], '/b': ['s3'] })

    expect(listActiveUserSessions(source)).toEqual([
      { sessionID: 's1', directory: '/a' },
      { sessionID: 's2', directory: '/a' },
      { sessionID: 's3', directory: '/b' },
    ])
  })

  it('excludes subagent and scheduled sessions', () => {
    const source = createSessionsSource()
    vi.mocked(source.getActiveSessions).mockReturnValue({ '/a': ['manual', 'sub', 'sched'] })
    vi.mocked(source.isSubagentSession).mockImplementation((id) => id === 'sub')
    vi.mocked(source.getScheduledSessionIds).mockReturnValue(new Set(['sched']))

    expect(listActiveUserSessions(source)).toEqual([{ sessionID: 'manual', directory: '/a' }])
  })
})

describe('restartOpenCode', () => {
  it('restarts the server through the supervisor with the restart reason', async () => {
    const supervisor = createSupervisor(true)

    await expect(restartOpenCode(supervisor)).resolves.toBeUndefined()
    expect(supervisor.restart).toHaveBeenCalledWith('settings_restart')
  })

  it('throws with the supervisor failure reason when the supervisor restart is unhealthy', async () => {
    const supervisor = createSupervisor(false, 'supervisor-specific failure')

    await expect(restartOpenCode(supervisor, 'settings_restart', createManager()))
      .rejects.toThrow('supervisor-specific failure')
  })

  it('falls back to the startup failure reason when the supervisor reports no error', async () => {
    const manager = createManager()
    vi.mocked(manager.getLastStartupError).mockReturnValue('OpenCode server failed to become healthy')

    await expect(restartOpenCode(createSupervisor(false, null), 'settings_restart', manager))
      .rejects.toThrow('OpenCode server failed to become healthy')
  })

  it('prefers the supervisor failure over the manager startup error', async () => {
    const manager = createManager()
    vi.mocked(manager.getLastStartupError).mockReturnValue('startup error from the manager')

    await expect(restartOpenCode(createSupervisor(false, 'supervisor-specific failure'), 'settings_restart', manager))
      .rejects.toThrow('supervisor-specific failure')
  })

  it('uses a generic failure message when neither the supervisor nor the manager reports an error', async () => {
    await expect(restartOpenCode(createSupervisor(false, null), 'settings_restart', createManager())).rejects.toThrow(
      'OpenCode server restart did not complete successfully',
    )
  })

  it('restarts the manager directly and propagates its failure when no supervisor is provided', async () => {
    const manager = createManager()
    vi.mocked(manager.restart).mockRejectedValue(new Error('server failed to become healthy'))

    await expect(restartOpenCode(undefined, 'settings_restart', manager))
      .rejects.toThrow('server failed to become healthy')
    expect(manager.clearStartupError).toHaveBeenCalled()
  })

  it('throws when a direct manager restart reports an unhealthy server', async () => {
    const manager = createManager()
    vi.mocked(manager.checkHealth).mockResolvedValue(false)

    await expect(restartOpenCode(undefined, 'settings_restart', manager))
      .rejects.toThrow('OpenCode server restart did not complete successfully')
  })
})

describe('reloadOpenCodeConfig', () => {
  let workspace: TempWorkspace
  let locationReload: Mock<OpenCodeApi['location']['reload']>

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-opencode-restart-')
    locationReload = vi.fn<OpenCodeApi['location']['reload']>(async () => undefined)
  })

  afterEach(() => {
    workspace.restore()
  })

  function client() {
    return createStubOpenCodeClient({ api: { location: { reload: locationReload } } })
  }

  it('throws a ConfigReloadError without reloading when every global source is absent', async () => {
    await expect(reloadOpenCodeConfig(client())).rejects.toMatchObject({
      name: 'ConfigReloadError',
      message: 'No OpenCode global configuration files found',
    })
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('throws a ConfigReloadError with validation issues without reloading when the config is invalid', async () => {
    mkdirSync(path.dirname(getOpenCodeConfigFilePath()), { recursive: true })
    writeFileSync(getOpenCodeConfigFilePath(), JSON.stringify({ model: 123 }), 'utf-8')

    const error = await reloadOpenCodeConfig(client()).catch((cause: Error) => cause)

    expect(error).toBeInstanceOf(ConfigReloadError)
    expect(error).toMatchObject({
      message: 'OpenCode global configuration is invalid',
      validationIssues: expect.arrayContaining([expect.objectContaining({ path: 'model' })]),
    })
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('reloads the OpenCode location for a valid config without restarting the server', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'openai/gpt-5' }))

    await reloadOpenCodeConfig(client())

    expect(locationReload).toHaveBeenCalledTimes(1)
  })

  it('propagates a location reload failure', async () => {
    await writeOpenCodeConfigFile(JSON.stringify({ $schema: 'https://opencode.ai/config.json' }))
    vi.mocked(locationReload).mockRejectedValue(new Error('OpenCode server unavailable'))

    await expect(reloadOpenCodeConfig(client())).rejects.toThrow('OpenCode server unavailable')
  })
})
