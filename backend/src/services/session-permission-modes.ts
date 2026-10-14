import type { Database } from 'bun:sqlite'
import type {
  SessionLockReason,
  SessionPermissionMode,
  SessionPermissionModeState,
} from '@opencode-manager/shared/schemas'
import { openCodeLocation, type PermissionRequest } from '@opencode-manager/shared/opencode'
import { getScheduleRunBySessionId } from '../db/schedules'
import {
  deleteSessionPermissionMode,
  getSessionPermissionMode,
  insertSessionPermissionModeIfAbsent,
  setSessionPermissionMode,
} from '../db/session-permission-modes'
import { logger } from '../utils/logger'
import type { OpenCodeClient } from './opencode/client'
import type { SessionAncestry } from './session-ancestry'
import type { SSEEvent } from './sse-aggregator'
import type { SettingsService } from './settings'

export class SessionPermissionModeError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class SessionPermissionModeService {
  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly settingsService: SettingsService,
    private readonly ancestry: SessionAncestry,
  ) {}

  async handleEvent(directory: string, event: SSEEvent): Promise<void> {
    switch (event.type) {
      case 'session.created': {
        const { sessionID, parentID, permissions } = event.data
        this.ancestry.rememberParent(sessionID, parentID)
        const hasExplicitPermissions = Array.isArray(permissions) && permissions.length > 0
        if (!parentID && !hasExplicitPermissions && this.defaultMode() === 'auto') {
          insertSessionPermissionModeIfAbsent(this.db, sessionID, 'auto')
        }
        return
      }
      case 'session.forked': {
        const { sessionID, parentID } = event.data
        this.ancestry.rememberParent(sessionID, null)
        const sourceMode = await this.getEffectiveMode(parentID)
        if (sourceMode.mode === 'auto') {
          insertSessionPermissionModeIfAbsent(this.db, sessionID, 'auto')
        }
        return
      }
      case 'permission.asked': {
        const { sessionID, id } = event.data
        await this.autoAcceptRequest(sessionID, id)
        return
      }
      case 'session.deleted': {
        const { sessionID } = event.data
        this.ancestry.forget(sessionID)
        deleteSessionPermissionMode(this.db, sessionID)
        return
      }
    }
  }

  async getEffectiveMode(sessionId: string): Promise<SessionPermissionModeState> {
    const rootSessionId = await this.resolveRootSessionIdOrNull(sessionId)
    return this.effectiveModeForRoot(sessionId, rootSessionId)
  }

  async setMode(sessionId: string, mode: SessionPermissionMode, directory: string): Promise<SessionPermissionModeState> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId)
    const lockedReason = this.lockReasonForRoot(sessionId, rootSessionId)
    if (lockedReason === 'schedule') {
      throw new SessionPermissionModeError(
        'Scheduled runs use their own permission configuration',
        409,
      )
    }

    if (lockedReason === 'child') {
      throw new SessionPermissionModeError(
        'Child sessions inherit the permission mode of their parent session',
        400,
      )
    }

    setSessionPermissionMode(this.db, sessionId, mode)
    if (mode === 'auto') {
      await this.acceptPendingRequestsInDirectory(directory, sessionId)
    }
    return { sessionId, rootSessionId, mode, lockedReason: null }
  }

  pinAsk(sessionId: string): void {
    setSessionPermissionMode(this.db, sessionId, 'ask')
  }

  defaultMode(): SessionPermissionMode {
    return this.settingsService.getSettings().preferences.sessionDefaults?.permissionMode ?? 'ask'
  }

  /**
   * Records the default permission mode for a session after it has been launched
   * and accepts any permission requests it raised before the mode was stored.
   *
   * Does nothing when the default mode is `ask`, since that needs no stored row.
   */
  async applyDefaultMode(sessionId: string, directory: string): Promise<void> {
    if (this.defaultMode() !== 'auto') {
      return
    }

    insertSessionPermissionModeIfAbsent(this.db, sessionId, 'auto')
    await this.acceptPendingRequestsInDirectory(directory, sessionId)
  }

  async acceptPendingRequestsForActiveSessions(): Promise<void> {
    try {
      const active = await this.openCodeClient.api.session.active()
      const directories = new Set<string>()

      for (const sessionId of Object.keys(active ?? {})) {
        const rootSessionId = await this.resolveRootSessionIdOrNull(sessionId)
        if (!rootSessionId) continue
        if (this.effectiveModeForRoot(sessionId, rootSessionId).mode !== 'auto') continue
        const directory = await this.resolveSessionDirectory(sessionId)
        if (directory) directories.add(directory)
      }

      for (const directory of directories) {
        await this.acceptPendingRequestsInDirectory(directory)
      }
    } catch (error) {
      logger.error('Failed to accept pending permission requests for active sessions:', error)
    }
  }

  private effectiveModeForRoot(
    sessionId: string,
    rootSessionId: string | null,
  ): SessionPermissionModeState {
    if (!rootSessionId) {
      return { sessionId, rootSessionId: sessionId, mode: 'ask', lockedReason: null }
    }

    const lockedReason = this.lockReasonForRoot(sessionId, rootSessionId)

    if (lockedReason === 'schedule') {
      return { sessionId, rootSessionId, mode: 'ask', lockedReason }
    }

    const stored = getSessionPermissionMode(this.db, rootSessionId)
    return { sessionId, rootSessionId, mode: stored ?? 'ask', lockedReason }
  }

  private lockReasonForRoot(sessionId: string, rootSessionId: string): SessionLockReason | null {
    if (getScheduleRunBySessionId(this.db, rootSessionId)) {
      return 'schedule'
    }

    return rootSessionId !== sessionId ? 'child' : null
  }

  private async acceptPendingRequestsInDirectory(directory: string, expectedRootSessionId?: string): Promise<void> {
    let requests: PermissionRequest[]
    try {
      const result = await this.openCodeClient.api.permission.request.list(openCodeLocation(directory))
      requests = result.data
    } catch (error) {
      logger.error(`Failed to list pending permission requests for directory ${directory}:`, error)
      return
    }

    for (const request of requests) {
      await this.autoAcceptRequest(request.sessionID, request.id, expectedRootSessionId)
    }
  }

  private async resolveSessionDirectory(sessionId: string): Promise<string | null> {
    try {
      const session = await this.openCodeClient.api.session.get({ sessionID: sessionId })
      return session.location.directory
    } catch (error) {
      logger.error(`Failed to resolve directory for session ${sessionId}:`, error)
      return null
    }
  }

  private async autoAcceptRequest(
    sessionID: string,
    requestID: string,
    expectedRootSessionId?: string,
  ): Promise<void> {
    const rootSessionId = await this.resolveRootSessionIdOrNull(sessionID)
    if (!rootSessionId) {
      return
    }

    if (expectedRootSessionId !== undefined && rootSessionId !== expectedRootSessionId) {
      return
    }

    if (this.effectiveModeForRoot(sessionID, rootSessionId).mode !== 'auto') {
      return
    }

    await this.replyOnce(sessionID, requestID)
  }

  private async replyOnce(sessionID: string, requestID: string): Promise<void> {
    try {
      await this.openCodeClient.api.permission.reply({ sessionID, requestID, decision: 'once' })
      logger.info(`Auto-accepted permission request ${requestID} for session ${sessionID}`)
    } catch (error) {
      logger.error(`Failed to auto-accept permission request ${requestID} for session ${sessionID}:`, error)
    }
  }

  private async resolveRootSessionIdOrNull(sessionId: string): Promise<string | null> {
    try {
      return await this.ancestry.resolveRootSessionId(sessionId)
    } catch {
      return null
    }
  }
}
