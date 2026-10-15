import type { Database } from 'bun:sqlite'
import type {
  SessionSandboxClaim,
  SessionSandboxResources,
  SessionSandboxState,
  SetSessionSandboxRequest,
} from '@opencode-manager/shared/schemas'
import {
  deleteSessionSandboxMode,
  getSessionSandboxMode,
  insertSessionSandboxModeIfAbsent,
  setSessionSandboxResources,
  setSessionSandboxed,
  type SessionSandboxModeRow,
} from '../db/session-sandbox-modes'
import { resolveSandboxResources, sandboxResourceLimitError } from './sandbox/resources'
import type { SessionAncestry } from './session-ancestry'
import type { SSEEvent } from './sse-aggregator'
import type { SettingsService } from './settings'
import { logger } from '../utils/logger'

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
    private readonly sandboxes: { removeSessionSandbox(rootSessionId: string): Promise<void> },
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
            resources: null,
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
          resources: parentRow?.resources ?? null,
        })
        return
      }
      case 'session.deleted': {
        const { sessionID } = event.data
        this.ancestry.forget(sessionID)
        if (getSessionSandboxMode(this.db, sessionID) !== null && this.sandboxSupported()) {
          this.removeSandboxInBackground(sessionID, `deleted session ${sessionID}`)
        }
        deleteSessionSandboxMode(this.db, sessionID)
        return
      }
    }
  }

  async getState(sessionId: string): Promise<SessionSandboxState> {
    const available = this.sandboxSupported()

    let rootSessionId: string
    try {
      rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    } catch {
      return this.buildState(sessionId, sessionId, available, null, null, available)
    }

    const lockedReason = rootSessionId !== sessionId ? 'child' : null
    const stored = getSessionSandboxMode(this.db, rootSessionId)

    if (!available) {
      return this.buildState(sessionId, rootSessionId, false, stored, lockedReason, false)
    }

    return this.buildState(sessionId, rootSessionId, stored?.sandboxed ?? this.defaultSandboxed(), stored, lockedReason, true)
  }

  async getClaim(sessionId: string): Promise<SessionSandboxClaim> {
    const available = this.sandboxSupported()

    let rootSessionId: string
    try {
      rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    } catch {
      return { sandboxed: available, source: 'default', since: 0 }
    }

    if (!available) {
      return { sandboxed: false, source: 'default', since: 0 }
    }

    const stored = getSessionSandboxMode(this.db, rootSessionId)
    if (!stored) {
      return { sandboxed: this.defaultSandboxed(), source: 'default', since: 0 }
    }

    return { sandboxed: stored.sandboxed, source: stored.source, since: stored.toggledAt }
  }

  async update(sessionId: string, request: SetSessionSandboxRequest): Promise<SessionSandboxState> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    if (rootSessionId !== sessionId) {
      throw new SessionSandboxError('Child sessions inherit sandboxing from their parent session', 400)
    }

    const available = this.sandboxSupported()
    if (request.sandboxed === true && !available) {
      throw new SessionSandboxError('Sandboxing is not enabled for this server', 409)
    }

    if (request.resources != null) {
      const limitError = sandboxResourceLimitError(request.resources)
      if (limitError !== null) {
        throw new SessionSandboxError(limitError, 400)
      }
    }

    const defaultSandboxed = this.defaultSandboxed()
    this.db.transaction(() => {
      if (request.sandboxed !== undefined) {
        setSessionSandboxed(this.db, sessionId, request.sandboxed)
      }
      if (request.resources !== undefined) {
        setSessionSandboxResources(this.db, sessionId, request.resources, defaultSandboxed)
      }
    })()

    if (request.sandboxed === false && available) {
      this.removeSandboxInBackground(sessionId, `session ${sessionId} after its sandbox was turned off`)
    }

    return this.getState(sessionId)
  }

  async resolveShellTarget(sessionId: string): Promise<{ rootSessionId: string; resources: SessionSandboxResources }> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    const stored = getSessionSandboxMode(this.db, rootSessionId)
    return {
      rootSessionId,
      resources: resolveSandboxResources(this.preferences().sandbox, stored?.resources ?? null),
    }
  }

  private removeSandboxInBackground(rootSessionId: string, reason: string): void {
    void this.sandboxes.removeSessionSandbox(rootSessionId).catch((error) => {
      logger.warn(
        `Failed to remove the sandbox microVM for ${reason}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
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
    const resources = stored?.resources ?? null
    return {
      sessionId,
      rootSessionId,
      sandboxed,
      source: stored?.source ?? 'default',
      resources,
      effectiveResources: resolveSandboxResources(this.preferences().sandbox, resources),
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
