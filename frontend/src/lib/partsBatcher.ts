import type { QueryClient } from '@tanstack/react-query'
import type { Part, MessageWithParts } from '@/api/types'

interface PartsBatcher {
  queuePartUpdate: (sessionID: string, part: Part) => void
  queuePartRemoval: (sessionID: string, messageID: string, partID: string) => void
  flush: () => void
  destroy: () => void
}

export function createPartsBatcher(
  queryClient: QueryClient,
  opcodeUrl: string,
  directory?: string
): PartsBatcher {
  const pendingUpserts = new Map<string, Map<string, Part>>()
  const pendingRemovals = new Map<string, Map<string, Set<string>>>()
  let pendingFrameId: number | null = null

  const scheduleFlush = () => {
    if (pendingFrameId !== null) return
    pendingFrameId = requestAnimationFrame(() => {
      pendingFrameId = null
      flush()
    })
  }

  const flush = () => {
    if (pendingUpserts.size === 0 && pendingRemovals.size === 0) return

    const sessionsToUpdate = new Set([
      ...pendingUpserts.keys(),
      ...pendingRemovals.keys(),
    ])

    for (const sessionID of sessionsToUpdate) {
      const queryKey = ['opencode', 'messages', opcodeUrl, sessionID, directory]
      const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)

      if (!currentData) continue

      let updatedData = [...currentData]

      const sessionUpserts = pendingUpserts.get(sessionID)
      const sessionRemovals = pendingRemovals.get(sessionID)

      updatedData = updatedData.map((msgWithParts) => {
        let msgParts = [...msgWithParts.parts]

        if (sessionRemovals?.has(msgWithParts.info.id)) {
          const partIDsToRemove = sessionRemovals.get(msgWithParts.info.id)!
          msgParts = msgParts.filter((p) => !partIDsToRemove.has(p.id))
        }

        if (sessionUpserts) {
          const partsForMessage = Array.from(sessionUpserts.values()).filter(
            (part) => part.messageID === msgWithParts.info.id
          )
          for (const part of partsForMessage) {
            const existingIdx = msgParts.findIndex((p) => p.id === part.id)
            if (existingIdx >= 0) {
              msgParts[existingIdx] = part
            } else {
              msgParts.push(part)
            }
          }
        }

        return {
          ...msgWithParts,
          parts: msgParts,
        }
      })

      queryClient.setQueryData(queryKey, updatedData)
    }

    pendingUpserts.clear()
    pendingRemovals.clear()
  }

  const queuePartUpdate = (sessionID: string, part: Part) => {
    if (!pendingUpserts.has(sessionID)) {
      pendingUpserts.set(sessionID, new Map())
    }
    const sessionUpserts = pendingUpserts.get(sessionID)!
    sessionUpserts.set(part.id, part)
    scheduleFlush()
  }

  const queuePartRemoval = (sessionID: string, messageID: string, partID: string) => {
    if (!pendingRemovals.has(sessionID)) {
      pendingRemovals.set(sessionID, new Map())
    }
    const sessionRemovals = pendingRemovals.get(sessionID)!
    if (!sessionRemovals.has(messageID)) {
      sessionRemovals.set(messageID, new Set())
    }
    const messageRemovals = sessionRemovals.get(messageID)!
    messageRemovals.add(partID)
    scheduleFlush()
  }

  const destroy = () => {
    if (pendingFrameId !== null) {
      cancelAnimationFrame(pendingFrameId)
      pendingFrameId = null
    }
    pendingUpserts.clear()
    pendingRemovals.clear()
  }

  return {
    queuePartUpdate,
    queuePartRemoval,
    flush,
    destroy,
  }
}
