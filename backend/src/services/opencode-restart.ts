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

function restartFailureError(manager: OpenCodeManagerProcess): Error {
  const startupError = manager.getLastStartupError()
  return new Error(startupError ?? 'OpenCode server restart did not complete successfully')
}

async function restartServer(
  supervisor: OpenCodeRestartTarget | undefined,
  reason: OpenCodeOperationReason,
  manager: OpenCodeManagerProcess,
): Promise<boolean> {
  if (supervisor) {
    return (await supervisor.restart(reason)).healthy
  }
  manager.clearStartupError()
  await manager.restart()
  return manager.checkHealth()
}

export async function restartOpenCode(
  supervisor?: OpenCodeRestartTarget,
  reason: OpenCodeOperationReason = 'settings_restart',
  manager: OpenCodeManagerProcess = opencodeServerManager,
): Promise<void> {
  const healthy = await restartServer(supervisor, reason, manager)
  if (!healthy) {
    throw restartFailureError(manager)
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
