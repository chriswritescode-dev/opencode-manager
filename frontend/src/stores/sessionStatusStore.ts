import { create } from 'zustand'

export type SessionStatusType = 
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'compact' }
  | { type: 'retry'; attempt: number; message: string; next: number }

interface StatusSnapshotToken {
  revision: number
  order: number
}

interface SessionStatusStore {
  statuses: Map<string, SessionStatusType>
  statusCache: Map<string, string>
  statusRevisions: Map<string, number>
  revision: number
  setStatus: (sessionID: string, status: SessionStatusType) => void
  setOptimisticActive: (sessionID: string, timeoutMs?: number) => void
  replaceStatuses: (statuses: Record<string, SessionStatusType>, token: StatusSnapshotToken) => void
  beginStatusSnapshot: () => StatusSnapshotToken
  endStatusSnapshot: (token: StatusSnapshotToken) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }
const OPTIMISTIC_ACTIVE_TIMEOUT_MS = 120_000
const optimisticActiveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlightSnapshots = new Map<number, number>()
let snapshotOrderCounter = 0
let lastAppliedSnapshotOrder = 0

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

const sameEntries = <V>(left: Map<string, V>, right: Map<string, V>): boolean => {
  if (left.size !== right.size) return false
  for (const [sessionID, value] of right.entries()) {
    if (left.get(sessionID) !== value) return false
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

const prunedRevisions = (currentRevisions: Map<string, number>): Map<string, number> => {
  const oldestSnapshotRevision = oldestInFlightSnapshotRevision()
  const nextRevisions = new Map<string, number>()
  if (oldestSnapshotRevision === null) return nextRevisions
  for (const [sessionID, revision] of currentRevisions.entries()) {
    if (revision > oldestSnapshotRevision) nextRevisions.set(sessionID, revision)
  }
  return nextRevisions
}

export function busyStatusesFromActiveSessions(active: Record<string, unknown>): Record<string, SessionStatusType> {
  return Object.fromEntries(
    Object.keys(active).map((sessionID) => [sessionID, { type: 'busy' as const }]),
  )
}

export const useSessionStatus = create<SessionStatusStore>((set, get) => {
  const recordRevisionPatch = (
    state: SessionStatusStore,
    sessionID: string,
  ): Pick<SessionStatusStore, 'statusRevisions' | 'revision'> | null => {
    if (inFlightSnapshots.size === 0) return null
    const revision = state.revision + 1
    const statusRevisions = new Map(state.statusRevisions)
    statusRevisions.set(sessionID, revision)
    return { statusRevisions, revision }
  }

  const applyStatusPatch = (
    state: SessionStatusStore,
    sessionID: string,
    status: SessionStatusType,
  ): Partial<SessionStatusStore> => {
    const statuses = new Map(state.statuses)
    const statusCache = new Map(state.statusCache)
    statuses.set(sessionID, status)
    statusCache.set(sessionID, getStatusHash(status))
    return { statuses, statusCache, ...(recordRevisionPatch(state, sessionID) ?? {}) }
  }

  return {
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    revision: 0,

    setStatus: (sessionID: string, status: SessionStatusType) => {
      if (status.type === 'idle') {
        get().clearStatus(sessionID)
        return
      }

      clearOptimisticActiveTimer(sessionID)
      if (get().statusCache.get(sessionID) === getStatusHash(status)) {
        const patch = recordRevisionPatch(get(), sessionID)
        if (patch) set(patch)
        return
      }

      set((state) => applyStatusPatch(state, sessionID, status))
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

      if (get().statusCache.get(sessionID) === getStatusHash({ type: 'busy' })) {
        const patch = recordRevisionPatch(get(), sessionID)
        if (patch) set(patch)
        return
      }

      set((state) => applyStatusPatch(state, sessionID, { type: 'busy' }))
    },

    replaceStatuses: (statuses: Record<string, SessionStatusType>, token: StatusSnapshotToken) => {
      releaseSnapshot(token)

      if (token.order < lastAppliedSnapshotOrder) {
        const currentRevisions = get().statusRevisions
        const nextRevisions = prunedRevisions(currentRevisions)
        if (!sameEntries(currentRevisions, nextRevisions)) {
          set({ statusRevisions: nextRevisions })
        }
        return
      }
      lastAppliedSnapshotOrder = token.order

      for (const sessionID of Object.keys(statuses)) {
        clearOptimisticActiveTimer(sessionID)
      }

      const currentStatuses = get().statuses
      const currentRevisions = get().statusRevisions
      const captureRevision = token.revision

      const isLiveAfterCapture = (sessionID: string): boolean => {
        if (optimisticActiveTimers.has(sessionID)) return true
        const touched = currentRevisions.get(sessionID)
        return touched !== undefined && touched > captureRevision
      }

      const newMap = new Map<string, SessionStatusType>()
      const newCache = new Map<string, string>()

      for (const [sessionID, status] of currentStatuses.entries()) {
        if (!isLiveAfterCapture(sessionID)) continue
        newMap.set(sessionID, status)
        newCache.set(sessionID, getStatusHash(status))
      }

      for (const [sessionID, status] of Object.entries(statuses)) {
        if (isLiveAfterCapture(sessionID)) continue
        if (status.type === 'idle') continue
        const current = currentStatuses.get(sessionID)
        const effective = status.type === 'busy' && current !== undefined && current.type !== 'idle' ? current : status
        newMap.set(sessionID, effective)
        newCache.set(sessionID, getStatusHash(effective))
      }

      const nextRevisions = prunedRevisions(currentRevisions)

      if (sameEntries(get().statusCache, newCache) && sameEntries(currentRevisions, nextRevisions)) return

      set({
        statuses: newMap,
        statusCache: newCache,
        statusRevisions: nextRevisions,
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
      if (inFlightSnapshots.size > 0) return
      if (get().statusRevisions.size === 0) return
      set({ statusRevisions: new Map() })
    },

    getStatus: (sessionID: string) => {
      return get().statuses.get(sessionID) || DEFAULT_STATUS
    },

    clearStatus: (sessionID: string) => {
      clearOptimisticActiveTimer(sessionID)
      if (!get().statuses.has(sessionID) && inFlightSnapshots.size === 0) return

      set((state) => {
        const revisionPatch = recordRevisionPatch(state, sessionID)
        if (!state.statuses.has(sessionID)) return revisionPatch ?? state
        const statuses = new Map(state.statuses)
        const statusCache = new Map(state.statusCache)
        statuses.delete(sessionID)
        statusCache.delete(sessionID)
        return { statuses, statusCache, ...(revisionPatch ?? {}) }
      })
    },
  }
})

export const useSessionStatusForSession = (sessionID: string | undefined): SessionStatusType => {
  return useSessionStatus((state) => 
    sessionID ? (state.statuses.get(sessionID) ?? DEFAULT_STATUS) : DEFAULT_STATUS
  )
}
