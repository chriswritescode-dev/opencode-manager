import type { QueryClient } from '@tanstack/react-query'
import type { Part, MessageWithParts } from '@/api/types'

interface PartsBatcher {
  queuePartUpdate: (sessionID: string, part: Part, directory?: string) => void
  queuePartDelta: (sessionID: string, messageID: string, partID: string, field: string, delta: string, directory?: string) => void
  queuePartRemoval: (sessionID: string, messageID: string, partID: string, directory?: string) => void
  flush: (target?: { sessionID?: string; directory?: string }) => void
  destroy: () => void
}

type PartOperation =
  | { type: 'upsert'; part: Part }
  | { type: 'delta'; messageID: string; partID: string; field: string; delta: string }
  | { type: 'remove'; messageID: string; partID: string }

type OperationGroup = {
  sessionID: string
  directory?: string
  operations: PartOperation[]
}

function groupKey(sessionID: string, directory?: string): string {
  return `${directory ?? ''}\0${sessionID}`
}

export function createPartsBatcher(
  queryClient: QueryClient,
  opcodeUrl: string,
): PartsBatcher {
  const pendingOperations = new Map<string, OperationGroup>()
  let pendingFrameId: number | null = null

  const scheduleFlush = () => {
    if (pendingFrameId !== null) return
    pendingFrameId = requestAnimationFrame(() => {
      pendingFrameId = null
      flush()
    })
  }

  const flush = (target?: { sessionID?: string; directory?: string }) => {
    if (pendingOperations.size === 0) return

    const groupsToDelete: string[] = []
    const invalidatedKeys = new Set<string>()

    const invalidateOnce = (queryKey: unknown[]) => {
      const dedupeKey = JSON.stringify(queryKey)
      if (invalidatedKeys.has(dedupeKey)) return
      invalidatedKeys.add(dedupeKey)
      queryClient.invalidateQueries({ queryKey })
    }

    for (const [key, group] of pendingOperations.entries()) {
      if (target) {
        if (target.sessionID !== undefined && group.sessionID !== target.sessionID) continue
        if (target.directory !== undefined && group.directory !== target.directory) continue
      }

      const { sessionID, directory } = group
      const queryKey = ['opencode', 'messages', opcodeUrl, sessionID, directory]
      const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)

      if (!currentData) {
        invalidateOnce(queryKey)
        continue
      }

      let updatedData = [...currentData]
      let anyApplied = false
      const unapplied: PartOperation[] = []
      const supersededPartIDs = new Set<string>()

      const applyToMessage = (
        messageID: string,
        operation: PartOperation,
        transform: (parts: Part[]) => Part[] | null,
      ): boolean => {
        const idx = updatedData.findIndex((m) => m.info.id === messageID)
        if (idx < 0) {
          unapplied.push(operation)
          return false
        }
        const parts = transform(updatedData[idx].parts)
        if (parts === null) {
          unapplied.push(operation)
          return false
        }
        const next = updatedData.slice()
        next[idx] = { ...updatedData[idx], parts }
        updatedData = next
        anyApplied = true
        return true
      }

      for (const operation of group.operations) {
        if (operation.type === 'upsert') {
          const applied = applyToMessage(operation.part.messageID, operation, (parts) => {
            const existingIdx = parts.findIndex((part) => part.id === operation.part.id)
            const nextParts = [...parts]
            if (existingIdx >= 0) {
              nextParts[existingIdx] = operation.part
            } else {
              nextParts.push(operation.part)
            }
            return nextParts
          })
          if (applied) supersededPartIDs.add(operation.part.id)
          continue
        }

        if (operation.type === 'remove') {
          const applied = applyToMessage(operation.messageID, operation, (parts) =>
            parts.filter((part) => part.id !== operation.partID),
          )
          if (applied) supersededPartIDs.add(operation.partID)
          continue
        }

        applyToMessage(operation.messageID, operation, (parts) => {
          if (!parts.some((p) => p.id === operation.partID)) return null
          return parts.map((part) => {
            if (part.id !== operation.partID) return part
            const currentValue = (part as Record<string, unknown>)[operation.field]
            const nextValue = `${typeof currentValue === 'string' ? currentValue : ''}${operation.delta}`
            return { ...part, [operation.field]: nextValue } as Part
          })
        })
      }

      if (anyApplied) {
        queryClient.setQueryData(queryKey, updatedData)
      }

      const filteredUnapplied = unapplied.filter((op) => {
        if (op.type === 'delta' || op.type === 'remove') {
          return !supersededPartIDs.has(op.partID)
        }
        return true
      })

      if (filteredUnapplied.length > 0) {
        group.operations = filteredUnapplied
        invalidateOnce(queryKey)
      } else {
        groupsToDelete.push(key)
      }
    }

    for (const key of groupsToDelete) {
      pendingOperations.delete(key)
    }
  }

  const queueOperation = (sessionID: string, operation: PartOperation, directory?: string) => {
    const key = groupKey(sessionID, directory)
    let group = pendingOperations.get(key)
    if (!group) {
      group = { sessionID, directory, operations: [] }
      pendingOperations.set(key, group)
    }
    group.operations.push(operation)
    scheduleFlush()
  }

  const queuePartUpdate = (sessionID: string, part: Part, directory?: string) => {
    queueOperation(sessionID, { type: 'upsert', part }, directory)
  }

  const queuePartDelta = (sessionID: string, messageID: string, partID: string, field: string, delta: string, directory?: string) => {
    queueOperation(sessionID, { type: 'delta', messageID, partID, field, delta }, directory)
  }

  const queuePartRemoval = (sessionID: string, messageID: string, partID: string, directory?: string) => {
    queueOperation(sessionID, { type: 'remove', messageID, partID }, directory)
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
