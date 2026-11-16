import type { Database } from 'bun:sqlite'
import type {
  SessionSandboxClaim,
  SessionSandboxState,
  SetSessionSandboxRequest,
} from '@opencode-manager/shared/schemas'
import {
  deleteSessionSandboxMode,
  getSessionSandboxMode,
  insertSessionSandboxModeIfAbsent,
  setSessionSandboxed,
  type SessionSandboxModeRow,
} from '../db/session-sandbox-modes'
import type { SessionAncestry } from './session-ancestry'
import type { SSEEvent } from './sse-aggregator'
import type { SettingsService } from './settings'

export class SessionSandboxError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class SessionSandboxService {
  constructor(
    private readonly db: Database,
    private readonly ancestry: SessionAncestry,
    private readonly settingsService: SettingsService,
  ) {}

  async handleEvent(directory: string | null, event: SSEEvent): Promise<void> {
    switch (event.type) {
      case 'session.created': {
        const { sessionID, parentID } = event.data
        this.ancestry.rememberParent(sessionID, parentID)
        if (!parentID) {
          insertSessionSandboxModeIfAbsent(this.db, sessionID, {
            sandboxed: this.defaultSandboxed(),
            source: 'default',
          })
        }
        return
      }
      case 'session.forked': {
        const { sessionID, parentID } = event.data
        this.ancestry.rememberParent(sessionID, null)
        const parentRow = await this.resolveParentRootRow(parentID)
        insertSessionSandboxModeIfAbsent(this.db, sessionID, {
          sandboxed: parentRow?.sandboxed ?? this.defaultSandboxed(),
          source: parentRow?.source ?? 'default',
        })
        return
      }
      case 'session.deleted': {
        const { sessionID } = event.data
        this.ancestry.forget(sessionID)
        deleteSessionSandboxMode(this.db, sessionID)
        return
      }
    }
  }

  async getState(sessionId: string): Promise<SessionSandboxState> {
    const available = this.sandboxSupported()
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)

    const lockedReason = rootSessionId !== sessionId ? 'child' : null
    const stored = getSessionSandboxMode(this.db, rootSessionId)

    if (!available) {
      return this.buildState(sessionId, rootSessionId, false, stored, lockedReason, false)
    }

    return this.buildState(sessionId, rootSessionId, stored?.sandboxed ?? this.defaultSandboxed(), stored, lockedReason, true)
  }

  async getClaim(sessionId: string): Promise<SessionSandboxClaim> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)

    if (!this.sandboxSupported()) {
      return { sandboxed: false }
    }

    const stored = getSessionSandboxMode(this.db, rootSessionId)
    return { sandboxed: stored?.sandboxed ?? this.defaultSandboxed() }
  }

  async update(sessionId: string, request: SetSessionSandboxRequest): Promise<SessionSandboxState> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    if (rootSessionId !== sessionId) {
      throw new SessionSandboxError('Child sessions inherit sandboxing from their parent session', 400)
    }

    this.assertSandboxRequestAllowed(request)

    setSessionSandboxed(this.db, sessionId, request.sandboxed)

    return this.getState(sessionId)
  }

  assertSandboxRequestAllowed(request: SetSessionSandboxRequest): void {
    if (request.sandboxed === true && !this.sandboxSupported()) {
      throw new SessionSandboxError('Sandboxing is not enabled for this server', 409)
    }
  }

  async resolveShellTarget(sessionId: string): Promise<{ sandboxed: boolean }> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    const stored = getSessionSandboxMode(this.db, rootSessionId)
    return {
      sandboxed: this.sandboxSupported() && (stored?.sandboxed ?? this.defaultSandboxed()),
    }
  }

  private async resolveParentRootRow(parentId: string): Promise<SessionSandboxModeRow | null> {
    let rootSessionId: string
    try {
      rootSessionId = await this.ancestry.resolveRootSessionId(parentId)
    } catch {
      return null
    }
    return getSessionSandboxMode(this.db, rootSessionId)
  }

  private buildState(
    sessionId: string,
    rootSessionId: string,
    sandboxed: boolean,
    stored: SessionSandboxModeRow | null,
    lockedReason: 'child' | null,
    available: boolean,
  ): SessionSandboxState {
    return {
      sessionId,
      rootSessionId,
      sandboxed,
      source: stored?.source ?? 'default',
      lockedReason,
      available,
    }
  }

  private preferences() {
    return this.settingsService.getSettings().preferences
  }

  private sandboxSupported(): boolean {
    return this.preferences().sandbox?.enabled === true
  }

  private defaultSandboxed(): boolean {
    return this.preferences().sandbox?.defaultForNewSessions ?? true
  }
}
