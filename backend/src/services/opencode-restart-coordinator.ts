import { logger } from '../utils/logger'
import type { OpenCodeClient } from './opencode/client'

export interface ActiveSessionsProvider {
  getActiveSessions(): Record<string, string[]>
  isSubagentSession(sessionId: string): boolean
  isScheduledSession(sessionId: string): boolean
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
    const sessions: ResumableSession[] = []

    for (const [directory, sessionIDs] of Object.entries(active)) {
      for (const sessionID of sessionIDs) {
        if (!this.activeSessions.isSubagentSession(sessionID) && !this.activeSessions.isScheduledSession(sessionID)) {
          sessions.push({ sessionID, directory })
        }
      }
    }

    return sessions
  }

  async abortSessions(sessions: ResumableSession[]): Promise<void> {
    for (const s of sessions) {
      try {
        await this.client.forward({
          method: 'POST',
          path: `/session/${s.sessionID}/abort`,
          directory: s.directory,
        })
      } catch (error) {
        logger.warn(`Failed to abort session ${s.sessionID}: ${error}`)
      }
    }
  }

  async resumeSessions(sessions: ResumableSession[]): Promise<string[]> {
    const resumed: string[] = []

    for (const s of sessions) {
      try {
        const response = await this.client.forward({
          method: 'POST',
          path: `/session/${s.sessionID}/prompt_async`,
          directory: s.directory,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
        })

        if (response.ok) {
          resumed.push(s.sessionID)
        }
      } catch (error) {
        logger.warn(`Failed to resume session ${s.sessionID}: ${error}`)
      }
    }

    return resumed
  }

  async runWithResume(restart: () => Promise<boolean>): Promise<RestartWithResumeResult> {
    const sessions = this.captureResumableSessions()
    await this.abortSessions(sessions)
    const healthy = await restart()
    const resumedSessionIDs = healthy ? await this.resumeSessions(sessions) : []
    return { healthy, resumedSessionIDs }
  }
}
