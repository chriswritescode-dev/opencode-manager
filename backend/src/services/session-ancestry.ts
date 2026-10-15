import type { OpenCodeClient } from './opencode/client'

const MAX_PARENT_HOPS = 10

export class SessionAncestry {
  private readonly parentBySession = new Map<string, string | null>()

  constructor(private readonly openCodeClient: OpenCodeClient) {}

  rememberParent(sessionId: string, parentId: string | null | undefined): void {
    this.parentBySession.set(sessionId, parentId ?? null)
  }

  forget(sessionId: string): void {
    this.parentBySession.delete(sessionId)
  }

  async resolveRootSessionId(sessionId: string): Promise<string> {
    let current = sessionId

    for (let hops = 0; hops < MAX_PARENT_HOPS; hops += 1) {
      const parentId = await this.getParentId(current)
      if (!parentId) {
        return current
      }
      current = parentId
    }

    return current
  }

  private async getParentId(sessionId: string): Promise<string | null> {
    if (this.parentBySession.has(sessionId)) {
      return this.parentBySession.get(sessionId) ?? null
    }

    const session = await this.openCodeClient.api.session.get({ sessionID: sessionId })
    const parentId = session.parentID ?? null
    this.parentBySession.set(sessionId, parentId)
    return parentId
  }
}
