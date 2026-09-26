import { create } from 'zustand'

export type SessionStatusType = 
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'compact' }
  | { type: 'retry'; attempt: number; message: string; next: number }

export interface StatusSnapshotToken {
  revision: number
  order: number
}

interface SessionStatusStore {
  statuses: Map<string, SessionStatusType>
  statusCache: Map<string, string>
  statusDirectories: Map<string, string>
  statusRevisions: Map<string, number>
  revision: number
  setStatus: (sessionID: string, status: SessionStatusType, directory?: string) => void
  setOptimisticActive: (sessionID: string, timeoutMs?: number) => void
  replaceStatuses: (statuses: Record<string, SessionStatusType>, directory?: string, token?: StatusSnapshotToken) => void
  beginStatusSnapshot: () => StatusSnapshotToken
  endStatusSnapshot: (token: StatusSnapshotToken) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }
const OPTIMISTIC_ACTIVE_TIMEOUT_MS = 120_000
const GLOBAL_SNAPSHOT_SCOPE = '__global__'
const optimisticActiveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlightSnapshots = new Map<number, number>()
const appliedSnapshotOrders = new Map<string, number>()
let snapshotOrderCounter = 0

const clearOptimisticActiveTimer = (sessionID: string): void => {
  const timer = optimisticActiveTimers.get(sessionID)
  if (!timer) return
  clearTimeout(timer)
  optimisticActiveTimers.delete(sessionID)
}

const getStatusHash = (status: SessionStatusType): string => {
  if (status.type === 'retry') {
    return `${status.type}:${status.attempt}:${status.message}:${status.next}`
  }
  return status.type
}

const sameDirectories = (left: Map<string, string>, right: Map<string, string>): boolean => {
  if (left.size !== right.size) return false
  for (const [sessionID, directory] of right.entries()) {
    if (left.get(sessionID) !== directory) return false
  }
  return true
}

const sameRevisions = (left: Map<string, number>, right: Map<string, number>): boolean => {
  if (left.size !== right.size) return false
  for (const [sessionID, revision] of right.entries()) {
    if (left.get(sessionID) !== revision) return false
  }
  return true
}

const registerSnapshot = (token: StatusSnapshotToken): void => {
  inFlightSnapshots.set(token.order, token.revision)
}

const releaseSnapshot = (token: StatusSnapshotToken): void => {
  inFlightSnapshots.delete(token.order)
}

const oldestInFlightSnapshotRevision = (): number | null => {
  let oldest: number | null = null
  for (const revision of inFlightSnapshots.values()) {
    if (oldest === null || revision < oldest) oldest = revision
  }
  return oldest
}

export function busyStatusesFromActiveSessions(active: Record<string, unknown>): Record<string, SessionStatusType> {
  return Object.fromEntries(
    Object.keys(active).map((sessionID) => [sessionID, { type: 'busy' as const }]),
  )
}

export const useSessionStatus = create<SessionStatusStore>((set, get) => ({
  statuses: new Map(),
  statusCache: new Map(),
  statusDirectories: new Map(),
  statusRevisions: new Map(),
  revision: 0,

  setStatus: (sessionID: string, status: SessionStatusType, directory?: string) => {
    clearOptimisticActiveTimer(sessionID)
    const hash = getStatusHash(status)
    const previousHash = get().statusCache.get(sessionID)

    if (status.type === 'idle') {
      const hasState = previousHash !== undefined
        || get().statusDirectories.has(sessionID)
        || get().statusRevisions.has(sessionID)
      if (!hasState && inFlightSnapshots.size === 0) return

      const nextRevision = get().revision + 1
      set((state) => {
        const newMap = new Map(state.statuses)
        const newCache = new Map(state.statusCache)
        const newDirectories = new Map(state.statusDirectories)
        const newRevisions = new Map(state.statusRevisions)
        newMap.delete(sessionID)
        newCache.delete(sessionID)
        newDirectories.delete(sessionID)
        newRevisions.set(sessionID, nextRevision)
        return {
          statuses: newMap,
          statusCache: newCache,
          statusDirectories: newDirectories,
          statusRevisions: newRevisions,
          revision: nextRevision,
        }
      })
      return
    }

    const hashChanged = previousHash !== hash
    const directoryChanged = Boolean(directory) && get().statusDirectories.get(sessionID) !== directory
    const nextRevision = get().revision + 1

    if (!hashChanged && !directoryChanged) {
      set((state) => {
        const newRevisions = new Map(state.statusRevisions)
        newRevisions.set(sessionID, nextRevision)
        return {
          statusRevisions: newRevisions,
          revision: nextRevision,
        }
      })
      return
    }

    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      const newDirectories = new Map(state.statusDirectories)
      const newRevisions = new Map(state.statusRevisions)
      if (hashChanged) {
        newMap.set(sessionID, status)
        newCache.set(sessionID, hash)
      }
      if (directory) newDirectories.set(sessionID, directory)
      newRevisions.set(sessionID, nextRevision)
      return {
        statuses: newMap,
        statusCache: newCache,
        statusDirectories: newDirectories,
        statusRevisions: newRevisions,
        revision: nextRevision,
      }
    })
  },

  setOptimisticActive: (sessionID: string, timeoutMs = OPTIMISTIC_ACTIVE_TIMEOUT_MS) => {
    clearOptimisticActiveTimer(sessionID)

    const timer = setTimeout(() => {
      optimisticActiveTimers.delete(sessionID)
      const currentStatus = get().getStatus(sessionID)
      if (currentStatus.type === 'busy') {
        get().clearStatus(sessionID)
      }
    }, timeoutMs)

    optimisticActiveTimers.set(sessionID, timer)

    const hash = getStatusHash({ type: 'busy' })
    const previousHash = get().statusCache.get(sessionID)
    if (previousHash === hash) return

    const nextRevision = get().revision + 1
    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      const newRevisions = new Map(state.statusRevisions)
      newMap.set(sessionID, { type: 'busy' })
      newCache.set(sessionID, hash)
      newRevisions.set(sessionID, nextRevision)
      return {
        statuses: newMap,
        statusCache: newCache,
        statusRevisions: newRevisions,
        revision: nextRevision,
      }
    })
  },

  replaceStatuses: (statuses: Record<string, SessionStatusType>, directory?: string, token?: StatusSnapshotToken) => {
    const scope = directory ?? GLOBAL_SNAPSHOT_SCOPE

    if (token) {
      releaseSnapshot(token)
      const appliedOrder = appliedSnapshotOrders.get(scope)
      if (appliedOrder !== undefined && token.order < appliedOrder) return
      appliedSnapshotOrders.set(scope, token.order)
    }

    for (const sessionID of Object.keys(statuses)) {
      clearOptimisticActiveTimer(sessionID)
    }

    const currentStatuses = get().statuses
    const currentDirectories = get().statusDirectories
    const currentRevisions = get().statusRevisions
    const captureRevision = token?.revision

    const isLiveAfterCapture = (sessionID: string): boolean => {
      if (optimisticActiveTimers.has(sessionID)) return true
      if (captureRevision === undefined) return false
      const touched = currentRevisions.get(sessionID)
      return touched !== undefined && touched > captureRevision
    }

    const newMap = new Map<string, SessionStatusType>()
    const newCache = new Map<string, string>()
    const newDirectories = new Map<string, string>()

    for (const [sessionID, status] of currentStatuses.entries()) {
      if (!isLiveAfterCapture(sessionID)) continue
      newMap.set(sessionID, status)
      newCache.set(sessionID, getStatusHash(status))
      const recorded = currentDirectories.get(sessionID)
      if (recorded !== undefined) newDirectories.set(sessionID, recorded)
    }

    if (directory !== undefined) {
      for (const [sessionID, status] of currentStatuses.entries()) {
        if (isLiveAfterCapture(sessionID)) continue
        const recorded = currentDirectories.get(sessionID)
        if (recorded === undefined || recorded === directory || sessionID in statuses) continue
        newMap.set(sessionID, status)
        newCache.set(sessionID, getStatusHash(status))
        newDirectories.set(sessionID, recorded)
      }
    }

    for (const [sessionID, status] of Object.entries(statuses)) {
      if (isLiveAfterCapture(sessionID)) continue
      if (status.type === 'idle') continue
      newMap.set(sessionID, status)
      newCache.set(sessionID, getStatusHash(status))
      if (directory !== undefined) {
        newDirectories.set(sessionID, directory)
      } else {
        const recorded = currentDirectories.get(sessionID)
        if (recorded !== undefined) newDirectories.set(sessionID, recorded)
      }
    }

    for (const sessionID of [...newDirectories.keys()]) {
      if (!newMap.has(sessionID)) newDirectories.delete(sessionID)
    }

    const oldestSnapshotRevision = oldestInFlightSnapshotRevision()
    const newRevisions = new Map<string, number>()
    for (const [sessionID, touched] of currentRevisions.entries()) {
      if (newMap.has(sessionID) || (oldestSnapshotRevision !== null && touched > oldestSnapshotRevision)) {
        newRevisions.set(sessionID, touched)
      }
    }

    if (!token) {
      const currentCache = get().statusCache
      if (currentCache.size === newCache.size) {
        let unchanged = true
        for (const [sessionID, hash] of newCache.entries()) {
          if (currentCache.get(sessionID) !== hash) {
            unchanged = false
            break
          }
        }
        if (unchanged && sameDirectories(currentDirectories, newDirectories) && sameRevisions(currentRevisions, newRevisions)) return
      }
    }

    set({
      statuses: newMap,
      statusCache: newCache,
      statusDirectories: newDirectories,
      statusRevisions: newRevisions,
    })
  },

  beginStatusSnapshot: () => {
    const token: StatusSnapshotToken = {
      revision: get().revision,
      order: ++snapshotOrderCounter,
    }
    registerSnapshot(token)
    return token
  },

  endStatusSnapshot: (token: StatusSnapshotToken) => {
    releaseSnapshot(token)
  },

  getStatus: (sessionID: string) => {
    return get().statuses.get(sessionID) || DEFAULT_STATUS
  },

  clearStatus: (sessionID: string) => {
    clearOptimisticActiveTimer(sessionID)
    const previousHash = get().statusCache.get(sessionID)
    const hasState = previousHash !== undefined
      || get().statusDirectories.has(sessionID)
      || get().statusRevisions.has(sessionID)
    if (!hasState && inFlightSnapshots.size === 0) return

    const nextRevision = get().revision + 1
    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      const newDirectories = new Map(state.statusDirectories)
      const newRevisions = new Map(state.statusRevisions)
      newMap.delete(sessionID)
      newCache.delete(sessionID)
      newDirectories.delete(sessionID)
      newRevisions.set(sessionID, nextRevision)
      return {
        statuses: newMap,
        statusCache: newCache,
        statusDirectories: newDirectories,
        statusRevisions: newRevisions,
        revision: nextRevision,
      }
    })
  },
}))

export const useSessionStatusForSession = (sessionID: string | undefined): SessionStatusType => {
  return useSessionStatus((state) => 
    sessionID ? (state.statuses.get(sessionID) ?? DEFAULT_STATUS) : DEFAULT_STATUS
  )
}
