import type { QueryClient } from '@tanstack/react-query'
import type { Part, MessageWithParts } from '@/api/types'

interface PartsBatcher {
  queuePartUpdate: (sessionID: string, part: Part) => void
  queuePartDelta: (sessionID: string, messageID: string, partID: string, field: string, delta: string) => void
  queuePartRemoval: (sessionID: string, messageID: string, partID: string) => void
  flush: () => void
  destroy: () => void
}

type PartOperation =
  | { type: 'upsert'; part: Part }
  | { type: 'delta'; messageID: string; partID: string; field: string; delta: string }
  | { type: 'remove'; messageID: string; partID: string }

export function createPartsBatcher(
  queryClient: QueryClient,
  opcodeUrl: string,
  directory?: string
): PartsBatcher {
  const pendingOperations = new Map<string, PartOperation[]>()
  let pendingFrameId: number | null = null

  const scheduleFlush = () => {
    if (pendingFrameId !== null) return
    pendingFrameId = requestAnimationFrame(() => {
      pendingFrameId = null
      flush()
    })
  }

  const flush = () => {
    if (pendingOperations.size === 0) return

    for (const [sessionID, operations] of pendingOperations.entries()) {
      const queryKey = ['opencode', 'messages', opcodeUrl, sessionID, directory]
      const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)

      if (!currentData) continue

      let updatedData = [...currentData]

      for (const operation of operations) {
        updatedData = updatedData.map((msgWithParts) => {
          if (operation.type === 'upsert') {
            if (msgWithParts.info.id !== operation.part.messageID) return msgWithParts

            const existingIdx = msgWithParts.parts.findIndex((part) => part.id === operation.part.id)
            const parts = [...msgWithParts.parts]
            if (existingIdx >= 0) {
              parts[existingIdx] = operation.part
            } else {
              parts.push(operation.part)
            }

            return { ...msgWithParts, parts }
          }

          if (msgWithParts.info.id !== operation.messageID) return msgWithParts

          if (operation.type === 'remove') {
            return {
              ...msgWithParts,
              parts: msgWithParts.parts.filter((part) => part.id !== operation.partID),
            }
          }

          return {
            ...msgWithParts,
            parts: msgWithParts.parts.map((part) => {
              if (part.id !== operation.partID) return part

              const currentValue = (part as Record<string, unknown>)[operation.field]
              const nextValue = `${typeof currentValue === 'string' ? currentValue : ''}${operation.delta}`
              return { ...part, [operation.field]: nextValue } as Part
            }),
          }
        })
      }

      queryClient.setQueryData(queryKey, updatedData)
    }

    pendingOperations.clear()
  }

  const queueOperation = (sessionID: string, operation: PartOperation) => {
    const operations = pendingOperations.get(sessionID) ?? []
    operations.push(operation)
    pendingOperations.set(sessionID, operations)
    scheduleFlush()
  }

  const queuePartUpdate = (sessionID: string, part: Part) => {
    queueOperation(sessionID, { type: 'upsert', part })
  }

  const queuePartDelta = (sessionID: string, messageID: string, partID: string, field: string, delta: string) => {
    queueOperation(sessionID, { type: 'delta', messageID, partID, field, delta })
  }

  const queuePartRemoval = (sessionID: string, messageID: string, partID: string) => {
    queueOperation(sessionID, { type: 'remove', messageID, partID })
  }

  const destroy = () => {
    if (pendingFrameId !== null) {
      cancelAnimationFrame(pendingFrameId)
      pendingFrameId = null
    }
    pendingOperations.clear()
  }

  return {
    queuePartUpdate,
    queuePartDelta,
    queuePartRemoval,
    flush,
    destroy,
  }
}
