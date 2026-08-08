import type { QueryClient } from '@tanstack/react-query'
import type { Part, MessageWithParts } from '@/api/types'
import { messagesQueryKey } from '@/lib/queryInvalidation'

interface PartsBatcher {
  queuePartUpdate: (sessionID: string, part: Part, directory?: string) => void
  queuePartDelta: (sessionID: string, messageID: string, partID: string, field: string, delta: string, directory?: string) => void
  queuePartRemoval: (sessionID: string, messageID: string, partID: string, directory?: string) => void
  flush: (target?: { sessionID?: string; directory?: string }) => void
  destroy: () => void
}

type PartOperation =
  | { type: 'upsert'; part: Part; deferred?: boolean }
  | { type: 'delta'; messageID: string; partID: string; field: string; delta: string; deferred?: boolean }
  | { type: 'remove'; messageID: string; partID: string }

type OperationGroup = {
  sessionID: string
  directory?: string
  operations: PartOperation[]
  firstDeferredAt?: number
}

export const DEFERRED_OPERATION_TTL_MS = 3000

function groupKey(sessionID: string, directory?: string): string {
  return `${directory ?? ''}\0${sessionID}`
}

function deferOperation(operation: PartOperation): PartOperation | undefined {
  if (operation.type === 'remove') return undefined
  return { ...operation, deferred: true }
}

function isGroupExpired(group: OperationGroup, now: number): boolean {
  return group.firstDeferredAt !== undefined && now - group.firstDeferredAt >= DEFERRED_OPERATION_TTL_MS
}

function stampDeferred(group: OperationGroup, now: number): void {
  if (group.firstDeferredAt === undefined) group.firstDeferredAt = now
}

export function createTextPart(sessionID: string, messageID: string, partID: string, text: string): Part {
  return { id: partID, sessionID, messageID, type: 'text', text } as Part
}

function appendPart(
  updatedData: MessageWithParts[],
  msgIdx: number,
  msg: MessageWithParts,
  part: Part,
  pIdx: Map<string, number>,
  supersededPartIDs: Set<string>,
): void {
  const nextParts = [...msg.parts, part]
  updatedData[msgIdx] = { ...msg, parts: nextParts }
  pIdx.set(part.id, nextParts.length - 1)
  supersededPartIDs.add(part.id)
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

    const now = Date.now()
    const groupsToDelete: string[] = []

    for (const [key, group] of pendingOperations.entries()) {
      if (target) {
        if (target.sessionID !== undefined && group.sessionID !== target.sessionID) continue
        if (target.directory !== undefined && group.directory !== target.directory) continue
      }

      if (group.operations.length === 0) {
        groupsToDelete.push(key)
        continue
      }

      const { sessionID, directory } = group
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory)
      const currentData = queryClient.getQueryData<MessageWithParts[]>(queryKey)

      if (!currentData) {
        if (group.firstDeferredAt === undefined) {
          queryClient.invalidateQueries({ queryKey })
        }
        const deferred = group.operations
          .map(deferOperation)
          .filter((operation): operation is PartOperation => Boolean(operation))
        if (deferred.length > 0 && !isGroupExpired(group, now)) {
          stampDeferred(group, now)
          group.operations = deferred
        } else {
          groupsToDelete.push(key)
        }
        continue
      }

      let updatedData = currentData
      let dataMutated = false
      const unapplied: PartOperation[] = []
      const supersededPartIDs = new Set<string>()
      const removedPartIDs = new Set<string>()

      const messageIdxById = new Map<string, number>()
      for (let i = 0; i < currentData.length; i++) {
        messageIdxById.set(currentData[i].info.id, i)
      }

      const partIdxCache = new Map<number, Map<string, number>>()

      const ensurePartIdx = (msgIdx: number, parts: Part[]): Map<string, number> => {
        let cache = partIdxCache.get(msgIdx)
        if (!cache) {
          cache = new Map()
          for (let i = 0; i < parts.length; i++) {
            cache.set(parts[i].id, i)
          }
          partIdxCache.set(msgIdx, cache)
        }
        return cache
      }

      for (const operation of group.operations) {
        if (operation.type === 'upsert') {
          const msgIdx = messageIdxById.get(operation.part.messageID)
          if (msgIdx === undefined) {
            const deferred = deferOperation(operation)
            if (deferred) unapplied.push(deferred)
            continue
          }
          if (!dataMutated) {
            updatedData = [...currentData]
            dataMutated = true
          }
          const msg = updatedData[msgIdx]
          const pIdx = ensurePartIdx(msgIdx, msg.parts)
          const existingPartIdx = pIdx.get(operation.part.id)
          if (operation.deferred && existingPartIdx !== undefined) {
            supersededPartIDs.add(operation.part.id)
            continue
          }
          if (existingPartIdx !== undefined) {
            const nextParts = [...msg.parts]
            nextParts[existingPartIdx] = operation.part
            updatedData[msgIdx] = { ...msg, parts: nextParts }
            supersededPartIDs.add(operation.part.id)
          } else {
            appendPart(updatedData, msgIdx, msg, operation.part, pIdx, supersededPartIDs)
          }
          continue
        }

        if (operation.type === 'remove') {
          const msgIdx = messageIdxById.get(operation.messageID)
          if (msgIdx === undefined) {
            unapplied.push(operation)
            continue
          }
          if (!dataMutated) {
            updatedData = [...currentData]
            dataMutated = true
          }
          const msg = updatedData[msgIdx]
          const pIdx = ensurePartIdx(msgIdx, msg.parts)
          if (pIdx.get(operation.partID) === undefined) {
            unapplied.push(operation)
            continue
          }
          const nextParts = msg.parts.filter((part) => part.id !== operation.partID)
          updatedData[msgIdx] = { ...msg, parts: nextParts }
          partIdxCache.delete(msgIdx)
          removedPartIDs.add(operation.partID)
          supersededPartIDs.add(operation.partID)
          continue
        }

        const msgIdx = messageIdxById.get(operation.messageID)
        if (msgIdx === undefined) {
          const deferred = deferOperation(operation)
          if (deferred) unapplied.push(deferred)
          continue
        }
        if (!dataMutated) {
          updatedData = [...currentData]
          dataMutated = true
        }
        const msg = updatedData[msgIdx]
        const pIdx = ensurePartIdx(msgIdx, msg.parts)
        if (removedPartIDs.has(operation.partID)) {
          continue
        }
        const pIdxResult = pIdx.get(operation.partID)
        if (pIdxResult === undefined) {
          if (operation.field === 'text') {
            appendPart(
              updatedData,
              msgIdx,
              msg,
              createTextPart(sessionID, operation.messageID, operation.partID, operation.delta),
              pIdx,
              supersededPartIDs,
            )
          } else {
            const deferred = deferOperation(operation)
            if (deferred) unapplied.push(deferred)
          }
          continue
        }
        if (operation.deferred) {
          supersededPartIDs.add(operation.partID)
          continue
        }
        const targetPart = msg.parts[pIdxResult]
        if (!targetPart) {
          unapplied.push(operation)
          continue
        }
        const nextParts = [...msg.parts]
        const currentValue = (targetPart as Record<string, unknown>)[operation.field]
        const nextValue = `${typeof currentValue === 'string' ? currentValue : ''}${operation.delta}`
        nextParts[pIdxResult] = { ...targetPart, [operation.field]: nextValue } as Part
        updatedData[msgIdx] = { ...msg, parts: nextParts }
      }

      if (dataMutated) {
        queryClient.setQueryData(queryKey, updatedData)
      }

      const retainedUnapplied = unapplied.filter((op) => {
        if (op.type === 'remove') return false
        if (op.type === 'delta') {
          return !supersededPartIDs.has(op.partID)
        }
        if (op.type === 'upsert') {
          return !supersededPartIDs.has(op.part.id)
        }
        return true
      })

      const needsInvalidate = retainedUnapplied.length > 0 || unapplied.some((op) => op.type === 'remove')
      const willRetain = retainedUnapplied.length > 0 && !isGroupExpired(group, now)

      if (needsInvalidate && group.firstDeferredAt === undefined) {
        queryClient.invalidateQueries({ queryKey })
      }

      if (willRetain) {
        stampDeferred(group, now)
        group.operations = retainedUnapplied
        continue
      }

      groupsToDelete.push(key)
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
