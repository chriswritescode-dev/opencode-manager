import { opencodeServerManager } from './opencode-single-server'
import type { OpenCodeSupervisor } from './opencode-supervisor'
import type { OpenCodeRestartCoordinator } from './opencode-restart-coordinator'

let restartCoordinator: OpenCodeRestartCoordinator | null = null

/**
 * Registers the process-wide restart coordinator so every restart path can
 * abort and resume in-flight sessions consistently. Passing null disables
 * resume (used by tests and pre-initialization paths).
 */
export function setOpenCodeRestartCoordinator(coordinator: OpenCodeRestartCoordinator | null): void {
  restartCoordinator = coordinator
}

export function getOpenCodeRestartCoordinator(): OpenCodeRestartCoordinator | null {
  return restartCoordinator
}

function restartFailureError(): Error {
  const startupError = opencodeServerManager.getLastStartupError()
  return new Error(startupError ?? 'OpenCode server restart did not complete successfully')
}

async function performRestart(supervisor?: OpenCodeSupervisor): Promise<boolean> {
  if (supervisor) {
    return (await supervisor.restart('settings_restart')).healthy
  }
  opencodeServerManager.clearStartupError()
  await opencodeServerManager.restart()
  const healthy = await opencodeServerManager.checkHealth()
  if (!healthy) {
    throw restartFailureError()
  }
  return healthy
}

/**
 * The single entry point for restarting the OpenCode server. Every restart
 * trigger (manual restart, version upgrade/install, workspace config change,
 * restart-sensitive config saves) routes through here so that interrupted user
 * sessions are aborted and resumed uniformly when a coordinator is registered.
 * A full process restart drops in-flight sessions; resuming re-issues a
 * "continue" prompt once the server is healthy again.
 */
export async function restartOpenCode(supervisor?: OpenCodeSupervisor): Promise<{ resumedSessionIDs: string[] }> {
  if (restartCoordinator) {
    const result = await restartCoordinator.runWithResume(() => performRestart(supervisor))
    if (!result.healthy) {
      throw restartFailureError()
    }
    return { resumedSessionIDs: result.resumedSessionIDs }
  }
  if (supervisor) {
    const status = await supervisor.restart('settings_restart')
    if (!status.healthy) {
      throw restartFailureError()
    }
  } else {
    opencodeServerManager.clearStartupError()
    await opencodeServerManager.restart()
    const healthy = await opencodeServerManager.checkHealth()
    if (!healthy) {
      throw restartFailureError()
    }
  }
  return { resumedSessionIDs: [] }
}

/**
 * Reloads OpenCode configuration via the non-disruptive API patch. This does
 * NOT drop the server process, so active sessions keep running and there is
 * nothing to resume.
 */
export async function reloadOpenCodeConfig(supervisor?: OpenCodeSupervisor): Promise<void> {
  if (supervisor) {
    const status = await supervisor.reloadConfig('settings_reload')
    if (!status.healthy) {
      const startupError = opencodeServerManager.getLastStartupError()
      throw new Error(startupError ?? 'OpenCode server reload did not complete successfully')
    }
    return
  }
  await opencodeServerManager.reloadConfig()
}
