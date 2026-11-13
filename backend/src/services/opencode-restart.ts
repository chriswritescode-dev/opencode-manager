import { opencodeServerManager, ConfigReloadError } from './opencode-single-server'
import { readOpenCodeConfigFile } from './opencode-config-file'
import { sseAggregator } from './sse-aggregator'
import type { OpenCodeClient } from './opencode/client'
import type { OpenCodeOperationReason, OpenCodeSupervisor } from './opencode-supervisor'

export type OpenCodeRestartTarget = Pick<OpenCodeSupervisor, 'restart'>

export interface ActiveSessionsSource {
  getActiveSessions(): Record<string, string[]>
  isSubagentSession(sessionId: string): boolean
  getScheduledSessionIds(): Set<string>
}

export interface ActiveUserSession {
  sessionID: string
  directory: string
}

export function listActiveUserSessions(source: ActiveSessionsSource = sseAggregator): ActiveUserSession[] {
  const scheduled = source.getScheduledSessionIds()
  return Object.entries(source.getActiveSessions()).flatMap(([directory, sessionIDs]) =>
    sessionIDs
      .filter((sessionID) => !source.isSubagentSession(sessionID) && !scheduled.has(sessionID))
      .map((sessionID) => ({ sessionID, directory })),
  )
}

export interface OpenCodeManagerProcess {
  clearStartupError: () => void
  restart: () => Promise<void>
  checkHealth: () => Promise<boolean>
  getLastStartupError: () => string | null
}

interface RestartOutcome {
  healthy: boolean
  error: string | null
}

function restartFailureError(manager: OpenCodeManagerProcess, supervisorError: string | null): Error {
  const reason = supervisorError ?? manager.getLastStartupError()
  return new Error(reason ?? 'OpenCode server restart did not complete successfully')
}

async function restartServer(
  supervisor: OpenCodeRestartTarget | undefined,
  reason: OpenCodeOperationReason,
  manager: OpenCodeManagerProcess,
): Promise<RestartOutcome> {
  if (supervisor) {
    const status = await supervisor.restart(reason)
    return { healthy: status.healthy, error: status.lastError }
  }
  manager.clearStartupError()
  await manager.restart()
  return { healthy: await manager.checkHealth(), error: null }
}

export async function restartOpenCode(
  supervisor?: OpenCodeRestartTarget,
  reason: OpenCodeOperationReason = 'settings_restart',
  manager: OpenCodeManagerProcess = opencodeServerManager,
): Promise<void> {
  const outcome = await restartServer(supervisor, reason, manager)
  if (!outcome.healthy) {
    throw restartFailureError(manager, outcome.error)
  }
}

export async function assertValidOpenCodeConfig(): Promise<void> {
  const config = await readOpenCodeConfigFile()
  if (!config) {
    throw new ConfigReloadError('No OpenCode global configuration files found')
  }
  if (!config.isValid) {
    throw new ConfigReloadError('OpenCode global configuration is invalid', config.validationIssues)
  }
}

export async function reloadOpenCodeConfig(openCodeClient: OpenCodeClient): Promise<void> {
  await assertValidOpenCodeConfig()
  await openCodeClient.api.location.reload()
}
