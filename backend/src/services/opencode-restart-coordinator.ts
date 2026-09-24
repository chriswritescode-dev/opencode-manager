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
  constructor(private readonly activeSessions: ActiveSessionsProvider) {}

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

  async runWithResume(restart: () => Promise<boolean>): Promise<RestartWithResumeResult> {
    const sessions = this.captureResumableSessions()
    const healthy = await restart()
    return {
      healthy,
      resumedSessionIDs: healthy ? sessions.map((session) => session.sessionID) : [],
    }
  }
}
