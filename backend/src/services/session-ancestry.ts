import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { OpenCodeClient } from './opencode/client'

const MAX_PARENT_HOPS = 10

export type SessionClientResolver = (serverId: string) => OpenCodeClient

function sessionKey(serverId: string, sessionId: string): string {
  return `${serverId}:${sessionId}`
}

export class SessionAncestry {
  private readonly parentBySession = new Map<string, string | null>()
  private readonly resolveClient: SessionClientResolver

  constructor(clientOrResolver: OpenCodeClient | SessionClientResolver) {
    this.resolveClient = typeof clientOrResolver === 'function' ? clientOrResolver : () => clientOrResolver
  }

  rememberParent(
    sessionId: string,
    parentId: string | null | undefined,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): void {
    this.parentBySession.set(sessionKey(serverId, sessionId), parentId ?? null)
  }

  forget(sessionId: string, serverId: string = LOCAL_OPENCODE_SERVER_ID): void {
    this.parentBySession.delete(sessionKey(serverId, sessionId))
  }

  async resolveRootSessionId(
    sessionId: string,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<string> {
    let current = sessionId

    for (let hops = 0; hops < MAX_PARENT_HOPS; hops += 1) {
      const parentId = await this.getParentId(current, serverId)
      if (!parentId) {
        return current
      }
      current = parentId
    }

    return current
  }

  private async getParentId(sessionId: string, serverId: string): Promise<string | null> {
    const key = sessionKey(serverId, sessionId)
    if (this.parentBySession.has(key)) {
      return this.parentBySession.get(key) ?? null
    }

    const session = await this.resolveClient(serverId).api.session.get({ sessionID: sessionId })
    const parentId = session.parentID ?? null
    this.parentBySession.set(key, parentId)
    return parentId
  }
}
