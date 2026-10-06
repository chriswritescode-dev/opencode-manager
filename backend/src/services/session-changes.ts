import type { FileDiffInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './opencode/client'

export const SESSION_CHANGES_CONTEXT_LINES = 3

export async function readSessionChanges(client: OpenCodeClient, sessionId: string): Promise<FileDiffInfo[]> {
  const [first, last] = await Promise.all([
    client.api.message.list({ sessionID: sessionId, type: 'user', order: 'asc', limit: 1 }),
    client.api.message.list({ sessionID: sessionId, type: 'user', order: 'desc', limit: 1 }),
  ])

  const from = first.data[0]
  const to = last.data[0]
  if (!from || !to) {
    return []
  }

  return client.api.session.diff({
    sessionID: sessionId,
    from: from.id,
    to: to.id,
    context: SESSION_CHANGES_CONTEXT_LINES,
  })
}
