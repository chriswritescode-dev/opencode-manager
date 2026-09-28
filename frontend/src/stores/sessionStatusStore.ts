import { create } from 'zustand'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { childLifecycle, type BackgroundTaskLifecycle, type ChildOutcome } from '@/lib/backgroundWork'

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
  knownSessions: Set<string>
  outcomes: Map<string, ChildOutcome>
  revision: number
  setStatus: (sessionID: string, status: SessionStatusType) => void
  setOutcome: (sessionID: string, outcome: ChildOutcome) => void
  clearOutcome: (sessionID: string) => void
  setOptimisticActive: (sessionID: string, timeoutMs?: number) => void
  replaceStatuses: (statuses: Record<string, SessionStatusType>, token: StatusSnapshotToken) => void
  applySessionSnapshot: (sessionID: string, session: SessionInfo, token: StatusSnapshotToken) => void
  beginStatusSnapshot: () => StatusSnapshotToken
  endStatusSnapshot: (token: StatusSnapshotToken) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
  forgetSession: (sessionID: string) => void
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

const sameSets = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) return false
  for (const value of right) {
    if (!left.has(value)) return false
  }
  return true
}

const markSessionKnown = (knownSessions: Set<string>, sessionID: string): Set<string> | null => {
  if (knownSessions.has(sessionID)) return null
  const next = new Set(knownSessions)
  next.add(sessionID)
  return next
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
    const knownSessions = markSessionKnown(state.knownSessions, sessionID)
    return {
      statuses,
      statusCache,
      ...(knownSessions ? { knownSessions } : {}),
      ...(recordRevisionPatch(state, sessionID) ?? {}),
    }
  }

  const isLiveAfterCapture = (sessionID: string, captureRevision: number): boolean => {
    if (optimisticActiveTimers.has(sessionID)) return true
    const touched = get().statusRevisions.get(sessionID)
    return touched !== undefined && touched > captureRevision
  }

  return {
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    revision: 0,

    setStatus: (sessionID: string, status: SessionStatusType) => {
      if (status.type === 'idle') {
        get().clearStatus(sessionID)
        return
      }

      clearOptimisticActiveTimer(sessionID)
      if (get().statusCache.get(sessionID) === getStatusHash(status)) {
        const revisionPatch = recordRevisionPatch(get(), sessionID)
        const knownSessions = markSessionKnown(get().knownSessions, sessionID)
        if (revisionPatch || knownSessions) {
          set({
            ...(revisionPatch ?? {}),
            ...(knownSessions ? { knownSessions } : {}),
          })
        }
        return
      }

      set((state) => applyStatusPatch(state, sessionID, status))
    },

    setOutcome: (sessionID: string, outcome: ChildOutcome) => {
      if (get().outcomes.get(sessionID) === outcome) {
        const knownSessions = markSessionKnown(get().knownSessions, sessionID)
        if (knownSessions) set({ knownSessions })
        return
      }
      set((state) => {
        const outcomes = new Map(state.outcomes)
        outcomes.set(sessionID, outcome)
        const knownSessions = markSessionKnown(state.knownSessions, sessionID)
        return { outcomes, ...(knownSessions ? { knownSessions } : {}) }
      })
    },

    clearOutcome: (sessionID: string) => {
      if (!get().outcomes.has(sessionID)) return
      set((state) => {
        const outcomes = new Map(state.outcomes)
        outcomes.delete(sessionID)
        return { outcomes }
      })
    },

    applySessionSnapshot: (sessionID: string, session: SessionInfo, token: StatusSnapshotToken) => {
      releaseSnapshot(token)
      if (isLiveAfterCapture(sessionID, token.revision)) return
      if (session.time.idle !== undefined) {
        get().setStatus(sessionID, { type: 'idle' })
        if (session.outcome) get().setOutcome(sessionID, session.outcome)
        return
      }
      get().clearOutcome(sessionID)
      get().setStatus(sessionID, { type: 'busy' })
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
      const currentKnownSessions = get().knownSessions
      const captureRevision = token.revision

      const newMap = new Map<string, SessionStatusType>()
      const newCache = new Map<string, string>()

      for (const [sessionID, status] of currentStatuses.entries()) {
        if (!isLiveAfterCapture(sessionID, captureRevision)) continue
        newMap.set(sessionID, status)
        newCache.set(sessionID, getStatusHash(status))
      }

      for (const [sessionID, status] of Object.entries(statuses)) {
        if (isLiveAfterCapture(sessionID, captureRevision)) continue
        if (status.type === 'idle') continue
        const current = currentStatuses.get(sessionID)
        const effective = status.type === 'busy' && current !== undefined && current.type !== 'idle' ? current : status
        newMap.set(sessionID, effective)
        newCache.set(sessionID, getStatusHash(effective))
      }

      const nextRevisions = prunedRevisions(currentRevisions)
      const nextKnownSessions = new Set<string>(Object.keys(statuses))
      for (const [sessionID, revision] of currentRevisions.entries()) {
        if (revision > captureRevision) nextKnownSessions.add(sessionID)
      }
      for (const sessionID of optimisticActiveTimers.keys()) {
        nextKnownSessions.add(sessionID)
      }
      for (const sessionID of currentKnownSessions) {
        if (!currentStatuses.has(sessionID)) nextKnownSessions.add(sessionID)
      }

      if (
        sameEntries(get().statusCache, newCache) &&
        sameEntries(currentRevisions, nextRevisions) &&
        sameSets(currentKnownSessions, nextKnownSessions)
      ) return

      set({
        statuses: newMap,
        statusCache: newCache,
        statusRevisions: nextRevisions,
        knownSessions: nextKnownSessions,
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
      const knownPatch = markSessionKnown(get().knownSessions, sessionID)
      if (!get().statuses.has(sessionID) && inFlightSnapshots.size === 0) {
        if (knownPatch) set({ knownSessions: knownPatch })
        return
      }

      set((state) => {
        const revisionPatch = recordRevisionPatch(state, sessionID)
        const knownSessions = markSessionKnown(state.knownSessions, sessionID)
        const knownFields = knownSessions ? { knownSessions } : {}
        if (!state.statuses.has(sessionID)) {
          return { ...(revisionPatch ?? {}), ...knownFields }
        }
        const statuses = new Map(state.statuses)
        const statusCache = new Map(state.statusCache)
        statuses.delete(sessionID)
        statusCache.delete(sessionID)
        return { statuses, statusCache, ...(revisionPatch ?? {}), ...knownFields }
      })
    },

    forgetSession: (sessionID: string) => {
      clearOptimisticActiveTimer(sessionID)
      const current = get()
      const hasSession =
        current.statuses.has(sessionID) ||
        current.statusCache.has(sessionID) ||
        current.knownSessions.has(sessionID) ||
        current.outcomes.has(sessionID)
      if (!hasSession && inFlightSnapshots.size === 0) return

      set((state) => {
        const statuses = new Map(state.statuses)
        const statusCache = new Map(state.statusCache)
        const knownSessions = new Set(state.knownSessions)
        const outcomes = new Map(state.outcomes)
        statuses.delete(sessionID)
        statusCache.delete(sessionID)
        knownSessions.delete(sessionID)
        outcomes.delete(sessionID)
        return {
          statuses,
          statusCache,
          knownSessions,
          outcomes,
          ...(recordRevisionPatch(state, sessionID) ?? {}),
        }
      })
    },
  }
})

export const useSessionStatusForSession = (sessionID: string | undefined): SessionStatusType => {
  return useSessionStatus((state) => 
    sessionID ? (state.statuses.get(sessionID) ?? DEFAULT_STATUS) : DEFAULT_STATUS
  )
}

export const useChildLifecycleForSession = (sessionID: string | undefined): BackgroundTaskLifecycle => {
  return useSessionStatus((state) => {
    if (!sessionID) return 'unknown'
    const status = state.statuses.get(sessionID) ?? DEFAULT_STATUS
    return childLifecycle(status, state.knownSessions.has(sessionID), state.outcomes.get(sessionID))
  })
}
