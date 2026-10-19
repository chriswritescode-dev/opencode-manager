import type { Database } from 'bun:sqlite'
import {
  LOCAL_OPENCODE_SERVER_ID,
  type SessionLockReason,
  type SessionPermissionMode,
  type SessionPermissionModeState,
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

export interface SessionClientProvider {
  getClient(serverId: string): OpenCodeClient
}

export type SessionClientSource = OpenCodeClient | SessionClientProvider

function isClientProvider(source: SessionClientSource): source is SessionClientProvider {
  return typeof (source as SessionClientProvider).getClient === 'function'
}

export class SessionPermissionModeError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class SessionPermissionModeService {
  private readonly clients: SessionClientProvider

  constructor(
    private readonly db: Database,
    clients: SessionClientSource,
    private readonly settingsService: SettingsService,
    private readonly ancestry: SessionAncestry,
  ) {
    this.clients = isClientProvider(clients) ? clients : { getClient: () => clients }
  }

  async handleEvent(
    directory: string | null,
    event: SSEEvent,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<void> {
    switch (event.type) {
      case 'session.created': {
        const { sessionID, parentID, permissions } = event.data
        this.ancestry.rememberParent(sessionID, parentID, serverId)
        const hasExplicitPermissions = Array.isArray(permissions) && permissions.length > 0
        if (!parentID && !hasExplicitPermissions && this.defaultMode() === 'auto') {
          insertSessionPermissionModeIfAbsent(this.db, sessionID, 'auto', serverId)
        }
        return
      }
      case 'session.forked': {
        const { sessionID, parentID } = event.data
        this.ancestry.rememberParent(sessionID, null, serverId)
        const sourceMode = await this.getEffectiveMode(parentID, serverId)
        if (sourceMode.mode === 'auto') {
          insertSessionPermissionModeIfAbsent(this.db, sessionID, 'auto', serverId)
        }
        return
      }
      case 'permission.asked': {
        const { sessionID, id } = event.data
        await this.autoAcceptRequest(sessionID, id, serverId)
        return
      }
      case 'session.deleted': {
        const { sessionID } = event.data
        this.ancestry.forget(sessionID, serverId)
        deleteSessionPermissionMode(this.db, sessionID, serverId)
        return
      }
    }
  }

  async getEffectiveMode(
    sessionId: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<SessionPermissionModeState> {
    const rootSessionId = await this.resolveRootSessionIdOrNull(sessionId, serverId)
    return this.effectiveModeForRoot(sessionId, rootSessionId, serverId)
  }

  async setMode(
    sessionId: string,
    mode: SessionPermissionMode,
    directory: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<SessionPermissionModeState> {
    const rootSessionId = await this.ancestry.resolveRootSessionId(sessionId, serverId)
    const lockedReason = this.lockReasonForRoot(sessionId, rootSessionId, serverId)
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

    setSessionPermissionMode(this.db, sessionId, mode, serverId)
    if (mode === 'auto') {
      await this.acceptPendingRequestsInDirectory(directory, serverId, sessionId)
    }
    return { sessionId, rootSessionId, mode, lockedReason: null }
  }

  pinAsk(sessionId: string, serverId: string = LOCAL_OPENCODE_SERVER_ID): void {
    setSessionPermissionMode(this.db, sessionId, 'ask', serverId)
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
  async applyDefaultMode(
    sessionId: string,
    directory: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<void> {
    if (this.defaultMode() !== 'auto') {
      return
    }

    insertSessionPermissionModeIfAbsent(this.db, sessionId, 'auto', serverId)
    await this.acceptPendingRequestsInDirectory(directory, serverId, sessionId)
  }

  async acceptPendingRequestsForActiveSessions(serverId: string = LOCAL_OPENCODE_SERVER_ID): Promise<void> {
    try {
      const client = this.clients.getClient(serverId)
      const active = await client.api.session.active()
      const directories = new Set<string>()

      for (const sessionId of Object.keys(active ?? {})) {
        const rootSessionId = await this.resolveRootSessionIdOrNull(sessionId, serverId)
        if (!rootSessionId) continue
        if (this.effectiveModeForRoot(sessionId, rootSessionId, serverId).mode !== 'auto') continue
        const directory = await this.resolveSessionDirectory(sessionId, serverId)
        if (directory) directories.add(directory)
      }

      for (const directory of directories) {
        await this.acceptPendingRequestsInDirectory(directory, serverId)
      }
    } catch (error) {
      logger.error(`Failed to accept pending permission requests for server ${serverId}:`, error)
    }
  }

  async suppressesPermissionNotification(
    event: SSEEvent,
    sessionId: string | undefined,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<boolean> {
    if (event.type !== 'permission.asked' || !sessionId) {
      return false
    }
    return (await this.getEffectiveMode(sessionId, serverId)).mode === 'auto'
  }

  private effectiveModeForRoot(
    sessionId: string,
    rootSessionId: string | null,
    serverId: string,
  ): SessionPermissionModeState {
    if (!rootSessionId) {
      return { sessionId, rootSessionId: sessionId, mode: 'ask', lockedReason: null }
    }

    const lockedReason = this.lockReasonForRoot(sessionId, rootSessionId, serverId)

    if (lockedReason === 'schedule') {
      return { sessionId, rootSessionId, mode: 'ask', lockedReason }
    }

    const stored = getSessionPermissionMode(this.db, rootSessionId, serverId)
    return { sessionId, rootSessionId, mode: stored ?? 'ask', lockedReason }
  }

  private lockReasonForRoot(
    sessionId: string,
    rootSessionId: string,
    serverId: string,
  ): SessionLockReason | null {
    if (serverId === LOCAL_OPENCODE_SERVER_ID && getScheduleRunBySessionId(this.db, rootSessionId)) {
      return 'schedule'
    }

    return rootSessionId !== sessionId ? 'child' : null
  }

  private async acceptPendingRequestsInDirectory(
    directory: string,
    serverId: string,
    expectedRootSessionId?: string,
  ): Promise<void> {
    let requests: PermissionRequest[]
    try {
      const result = await this.clients
        .getClient(serverId)
        .api.permission.request.list(openCodeLocation(directory))
      requests = result.data
    } catch (error) {
      logger.error(`Failed to list pending permission requests for directory ${directory}:`, error)
      return
    }

    for (const request of requests) {
      await this.autoAcceptRequest(request.sessionID, request.id, serverId, expectedRootSessionId)
    }
  }

  private async resolveSessionDirectory(sessionId: string, serverId: string): Promise<string | null> {
    try {
      const session = await this.clients.getClient(serverId).api.session.get({ sessionID: sessionId })
      return session.location.directory
    } catch (error) {
      logger.error(`Failed to resolve directory for session ${sessionId}:`, error)
      return null
    }
  }

  private async autoAcceptRequest(
    sessionID: string,
    requestID: string,
    serverId: string,
    expectedRootSessionId?: string,
  ): Promise<void> {
    const rootSessionId = await this.resolveRootSessionIdOrNull(sessionID, serverId)
    if (!rootSessionId) {
      return
    }

    if (expectedRootSessionId !== undefined && rootSessionId !== expectedRootSessionId) {
      return
    }

    if (this.effectiveModeForRoot(sessionID, rootSessionId, serverId).mode !== 'auto') {
      return
    }

    await this.replyOnce(sessionID, requestID, serverId)
  }

  private async replyOnce(sessionID: string, requestID: string, serverId: string): Promise<void> {
    try {
      await this.clients
        .getClient(serverId)
        .api.permission.reply({ sessionID, requestID, decision: 'once' })
      logger.info(`Auto-accepted permission request ${requestID} for session ${sessionID}`)
    } catch (error) {
      logger.error(`Failed to auto-accept permission request ${requestID} for session ${sessionID}:`, error)
    }
  }

  private async resolveRootSessionIdOrNull(sessionId: string, serverId: string): Promise<string | null> {
    try {
      return await this.ancestry.resolveRootSessionId(sessionId, serverId)
    } catch {
      return null
    }
  }
}
