import { opencodeServerManager, ConfigReloadError } from './opencode-single-server'
import { readOpenCodeConfigFile } from './opencode-config-file'
import { sseAggregator } from './sse-aggregator'
import type { OpenCodeClient } from './opencode/client'
import type { OpenCodeOperationReason, OpenCodeSupervisor } from './opencode-supervisor'

export interface ActiveSessionsSource {
  getActiveSessions(): Record<string, string[]>
  isSubagentSession(sessionId: string): boolean
  getScheduledSessionIds(): Set<string>
}

export interface ActiveUserSession {
  sessionID: string
  directory: string
}

export interface OpenCodeRestartResult {
  interruptedSessionIDs: string[]
}

export function listActiveUserSessions(source: ActiveSessionsSource = sseAggregator): ActiveUserSession[] {
  const scheduled = source.getScheduledSessionIds()
  return Object.entries(source.getActiveSessions()).flatMap(([directory, sessionIDs]) =>
    sessionIDs
      .filter((sessionID) => !source.isSubagentSession(sessionID) && !scheduled.has(sessionID))
      .map((sessionID) => ({ sessionID, directory })),
  )
}

function restartFailureError(): Error {
  const startupError = opencodeServerManager.getLastStartupError()
  return new Error(startupError ?? 'OpenCode server restart did not complete successfully')
}

async function restartServer(supervisor: OpenCodeSupervisor | undefined, reason: OpenCodeOperationReason): Promise<boolean> {
  if (supervisor) {
    return (await supervisor.restart(reason)).healthy
  }
  opencodeServerManager.clearStartupError()
  await opencodeServerManager.restart()
  return opencodeServerManager.checkHealth()
}

export async function restartOpenCode(
  supervisor?: OpenCodeSupervisor,
  reason: OpenCodeOperationReason = 'settings_restart',
): Promise<OpenCodeRestartResult> {
  const interruptedSessionIDs = listActiveUserSessions().map((session) => session.sessionID)
  const healthy = await restartServer(supervisor, reason)
  if (!healthy) {
    throw restartFailureError()
  }
  return { interruptedSessionIDs }
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
