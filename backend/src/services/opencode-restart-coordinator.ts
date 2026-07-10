import { logger } from '../utils/logger'
import type { OpenCodeClient } from './opencode/client'

export interface ActiveSessionsProvider {
  getActiveSessions(): Record<string, string[]>
  isSubagentSession(sessionId: string): boolean
  getScheduledSessionIds(): Set<string>
}

export interface ResumableSession {
  sessionID: string
  directory: string
}

export interface RestartWithResumeResult {
  healthy: boolean
  resumedSessionIDs: string[]
}

export class OpenCodeRestartCoordinator {
  constructor(
    private readonly client: OpenCodeClient,
    private readonly activeSessions: ActiveSessionsProvider,
  ) {}

  captureResumableSessions(): ResumableSession[] {
    const active = this.activeSessions.getActiveSessions()
    const scheduled = this.activeSessions.getScheduledSessionIds()
    const sessions: ResumableSession[] = []

    for (const [directory, sessionIDs] of Object.entries(active)) {
      for (const sessionID of sessionIDs) {
        if (!this.activeSessions.isSubagentSession(sessionID) && !scheduled.has(sessionID)) {
          sessions.push({ sessionID, directory })
        }
      }
    }

    return sessions
  }

  async abortSessions(sessions: ResumableSession[]): Promise<void> {
    await Promise.allSettled(
      sessions.map(async (s) => {
        try {
          await this.client.forward({
            method: 'POST',
            path: `/api/session/${s.sessionID}/interrupt`,
          })
        } catch (error) {
          logger.warn(`Failed to abort session ${s.sessionID}: ${error}`)
        }
      }),
    )
  }

  async resumeSessions(sessions: ResumableSession[]): Promise<string[]> {
    const results = await Promise.allSettled(
      sessions.map(async (s) => {
        try {
          const response = await this.client.forward({
            method: 'POST',
            path: `/api/session/${s.sessionID}/prompt`,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: { text: 'continue' } }),
          })
          return response.ok ? s.sessionID : null
        } catch (error) {
          logger.warn(`Failed to resume session ${s.sessionID}: ${error}`)
          return null
        }
      }),
    )

    return results
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter((sessionID): sessionID is string => sessionID !== null)
  }

  async runWithResume(restart: () => Promise<boolean>): Promise<RestartWithResumeResult> {
    const sessions = this.captureResumableSessions()
    await this.abortSessions(sessions)
    const healthy = await restart()
    const resumedSessionIDs = healthy ? await this.resumeSessions(sessions) : []
    return { healthy, resumedSessionIDs }
  }
}
