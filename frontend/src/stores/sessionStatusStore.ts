import { create } from 'zustand'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
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

interface ShellSnapshotToken {
  revision: number
  order: number
}

interface RunningShell {
  sessionID: string
  directory: string
}

interface SessionStatusStore {
  statuses: Map<string, SessionStatusType>
  statusCache: Map<string, string>
  statusRevisions: Map<string, number>
  knownSessions: Set<string>
  outcomes: Map<string, ChildOutcome>
  parents: Map<string, string | null>
  directories: Map<string, string>
  sessionServers: Map<string, string>
  runningShells: Map<string, RunningShell>
  shellRevisions: Map<string, number>
  shellRevision: number
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
  setSessionParent: (sessionID: string, parentID: string | null) => void
  setSessionDirectory: (sessionID: string, directory: string) => void
  setSessionServer: (sessionID: string, serverId: string) => void
  setShellRunning: (shellID: string, sessionID: string, directory: string) => void
  clearShell: (shellID: string) => void
  replaceRunningShells: (directory: string, shells: Array<{ id: string; sessionID: string }>, token: ShellSnapshotToken) => void
  beginShellSnapshot: () => ShellSnapshotToken
  endShellSnapshot: (token: ShellSnapshotToken) => void
  forgetSession: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }
const OPTIMISTIC_ACTIVE_TIMEOUT_MS = 120_000
const optimisticActiveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlightSnapshots = new Map<number, number>()
let snapshotOrderCounter = 0
let lastAppliedSnapshotOrder = 0
const inFlightShellSnapshots = new Map<number, number>()
let shellSnapshotOrderCounter = 0

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

const sameRunningShells = (left: Map<string, RunningShell>, right: Map<string, RunningShell>): boolean => {
  if (left.size !== right.size) return false
  for (const [shellID, shell] of right.entries()) {
    const existing = left.get(shellID)
    if (!existing || existing.sessionID !== shell.sessionID || existing.directory !== shell.directory) return false
  }
  return true
}

const registerShellSnapshot = (token: ShellSnapshotToken): void => {
  inFlightShellSnapshots.set(token.order, token.revision)
}

const releaseShellSnapshot = (token: ShellSnapshotToken): void => {
  inFlightShellSnapshots.delete(token.order)
}

const oldestInFlightShellSnapshotRevision = (): number | null => {
  let oldest: number | null = null
  for (const revision of inFlightShellSnapshots.values()) {
    if (oldest === null || revision < oldest) oldest = revision
  }
  return oldest
}

const prunedShellRevisions = (currentRevisions: Map<string, number>): Map<string, number> => {
  const oldestSnapshotRevision = oldestInFlightShellSnapshotRevision()
  const nextRevisions = new Map<string, number>()
  if (oldestSnapshotRevision === null) return nextRevisions
  for (const [shellID, revision] of currentRevisions.entries()) {
    if (revision > oldestSnapshotRevision) nextRevisions.set(shellID, revision)
  }
  return nextRevisions
}

const shellTouchPatch = (
  state: Pick<SessionStatusStore, 'shellRevisions' | 'shellRevision'>,
  shellIDs: string[],
): Pick<SessionStatusStore, 'shellRevisions' | 'shellRevision'> | null => {
  if (inFlightShellSnapshots.size === 0 || shellIDs.length === 0) return null
  let shellRevision = state.shellRevision
  const shellRevisions = new Map(state.shellRevisions)
  for (const shellID of shellIDs) {
    shellRevision += 1
    shellRevisions.set(shellID, shellRevision)
  }
  return { shellRevisions, shellRevision }
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

export function hasBackgroundActivity(
  state: Pick<SessionStatusStore, 'statuses' | 'parents' | 'runningShells'>,
  sessionID: string,
): boolean {
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    for (const shell of state.runningShells.values()) {
      if (shell.sessionID === id) return true
    }
    for (const [childID, parentID] of state.parents.entries()) {
      if (parentID !== id) continue
      const childStatus = state.statuses.get(childID)
      if (childStatus && childStatus.type !== 'idle') return true
      if (visit(childID)) return true
    }
    return false
  }
  return visit(sessionID)
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

  const isRemoteOwned = (sessionID: string): boolean => get().sessionServers.has(sessionID)

  return {
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
    directories: new Map(),
    sessionServers: new Map(),
    runningShells: new Map(),
    shellRevisions: new Map(),
    shellRevision: 0,
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
        if (!isLiveAfterCapture(sessionID, captureRevision) && !isRemoteOwned(sessionID)) continue
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
      for (const sessionID of newMap.keys()) {
        if (isRemoteOwned(sessionID)) nextKnownSessions.add(sessionID)
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

    setSessionParent: (sessionID: string, parentID: string | null) => {
      const current = get().parents
      if (current.has(sessionID) && current.get(sessionID) === parentID) return
      set((state) => {
        const parents = new Map(state.parents)
        parents.set(sessionID, parentID)
        return { parents }
      })
    },

    setSessionDirectory: (sessionID: string, directory: string) => {
      if (get().directories.get(sessionID) === directory) return
      set((state) => {
        const directories = new Map(state.directories)
        directories.set(sessionID, directory)
        return { directories }
      })
    },

    setSessionServer: (sessionID: string, serverId: string) => {
      if (serverId === LOCAL_OPENCODE_SERVER_ID) return
      if (get().sessionServers.get(sessionID) === serverId) return
      set((state) => {
        const sessionServers = new Map(state.sessionServers)
        sessionServers.set(sessionID, serverId)
        return { sessionServers }
      })
    },

    setShellRunning: (shellID: string, sessionID: string, directory: string) => {
      const current = get().runningShells.get(shellID)
      if (current && current.sessionID === sessionID && current.directory === directory) {
        const touch = shellTouchPatch(get(), [shellID])
        if (touch) set(touch)
        return
      }
      set((state) => {
        const runningShells = new Map(state.runningShells)
        runningShells.set(shellID, { sessionID, directory })
        return { runningShells, ...(shellTouchPatch(state, [shellID]) ?? {}) }
      })
    },

    clearShell: (shellID: string) => {
      if (!get().runningShells.has(shellID)) {
        const touch = shellTouchPatch(get(), [shellID])
        if (touch) set(touch)
        return
      }
      set((state) => {
        const runningShells = new Map(state.runningShells)
        runningShells.delete(shellID)
        return { runningShells, ...(shellTouchPatch(state, [shellID]) ?? {}) }
      })
    },

    replaceRunningShells: (directory: string, shells: Array<{ id: string; sessionID: string }>, token: ShellSnapshotToken) => {
      releaseShellSnapshot(token)

      const current = get().runningShells
      const currentRevisions = get().shellRevisions
      const runningShells = new Map(current)
      const isTouched = (shellID: string): boolean => {
        const revision = currentRevisions.get(shellID)
        return revision !== undefined && revision > token.revision
      }

      for (const [shellID, shell] of runningShells.entries()) {
        if (shell.directory !== directory) continue
        if (isTouched(shellID)) continue
        runningShells.delete(shellID)
      }
      for (const shell of shells) {
        if (isTouched(shell.id)) continue
        runningShells.set(shell.id, { sessionID: shell.sessionID, directory })
      }

      const nextRevisions = prunedShellRevisions(currentRevisions)
      const shellsChanged = !sameRunningShells(current, runningShells)
      const revisionsChanged = !sameEntries(currentRevisions, nextRevisions)
      if (!shellsChanged && !revisionsChanged) return

      set({
        ...(shellsChanged ? { runningShells } : {}),
        ...(revisionsChanged ? { shellRevisions: nextRevisions } : {}),
      })
    },

    beginShellSnapshot: () => {
      const token: ShellSnapshotToken = {
        revision: get().shellRevision,
        order: ++shellSnapshotOrderCounter,
      }
      registerShellSnapshot(token)
      return token
    },

    endShellSnapshot: (token: ShellSnapshotToken) => {
      releaseShellSnapshot(token)
      if (inFlightShellSnapshots.size > 0) return
      if (get().shellRevisions.size === 0) return
      set({ shellRevisions: new Map() })
    },

    forgetSession: (sessionID: string) => {
      clearOptimisticActiveTimer(sessionID)
      const current = get()
      const ownsShell = Array.from(current.runningShells.values()).some((shell) => shell.sessionID === sessionID)
      const hasSession =
        current.statuses.has(sessionID) ||
        current.statusCache.has(sessionID) ||
        current.knownSessions.has(sessionID) ||
        current.outcomes.has(sessionID) ||
        current.parents.has(sessionID) ||
        current.directories.has(sessionID) ||
        current.sessionServers.has(sessionID) ||
        ownsShell
      if (!hasSession && inFlightSnapshots.size === 0) return

      set((state) => {
        const statuses = new Map(state.statuses)
        const statusCache = new Map(state.statusCache)
        const knownSessions = new Set(state.knownSessions)
        const outcomes = new Map(state.outcomes)
        const parents = new Map(state.parents)
        const directories = new Map(state.directories)
        const sessionServers = new Map(state.sessionServers)
        const runningShells = new Map(state.runningShells)
        statuses.delete(sessionID)
        statusCache.delete(sessionID)
        knownSessions.delete(sessionID)
        outcomes.delete(sessionID)
        parents.delete(sessionID)
        directories.delete(sessionID)
        sessionServers.delete(sessionID)
        const removedShellIDs: string[] = []
        for (const [shellID, shell] of runningShells.entries()) {
          if (shell.sessionID !== sessionID) continue
          runningShells.delete(shellID)
          removedShellIDs.push(shellID)
        }
        return {
          statuses,
          statusCache,
          knownSessions,
          outcomes,
          parents,
          directories,
          sessionServers,
          runningShells,
          ...(shellTouchPatch(state, removedShellIDs) ?? {}),
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

export const useHasBackgroundActivity = (sessionID: string | undefined): boolean => {
  return useSessionStatus((state) => (sessionID ? hasBackgroundActivity(state, sessionID) : false))
}
