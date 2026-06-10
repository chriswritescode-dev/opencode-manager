import { create } from 'zustand'

export type SessionStatusType = 
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'compact' }
  | { type: 'retry'; attempt: number; message: string; next: number }

interface SessionStatusStore {
  statuses: Map<string, SessionStatusType>
  statusCache: Map<string, string>
  setStatus: (sessionID: string, status: SessionStatusType) => void
  setOptimisticActive: (sessionID: string, timeoutMs?: number) => void
  replaceStatuses: (statuses: Record<string, SessionStatusType>) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }
const OPTIMISTIC_ACTIVE_TIMEOUT_MS = 120_000
const optimisticActiveTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

export const useSessionStatus = create<SessionStatusStore>((set, get) => ({
  statuses: new Map(),
  statusCache: new Map(),
  
  setStatus: (sessionID: string, status: SessionStatusType) => {
    clearOptimisticActiveTimer(sessionID)
    const hash = getStatusHash(status)
    const previousHash = get().statusCache.get(sessionID)
    
    if (previousHash === hash) return

    if (status.type === 'idle') {
      if (!previousHash) return

      set((state) => {
        const newMap = new Map(state.statuses)
        const newCache = new Map(state.statusCache)
        newMap.delete(sessionID)
        newCache.delete(sessionID)
        return { statuses: newMap, statusCache: newCache }
      })
      return
    }
    
    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      newMap.set(sessionID, status)
      newCache.set(sessionID, hash)
      return { statuses: newMap, statusCache: newCache }
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

    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      newMap.set(sessionID, { type: 'busy' })
      newCache.set(sessionID, hash)
      return { statuses: newMap, statusCache: newCache }
    })
  },

  replaceStatuses: (statuses: Record<string, SessionStatusType>) => {
    for (const sessionID of Object.keys(statuses)) {
      clearOptimisticActiveTimer(sessionID)
    }

    const newMap = new Map<string, SessionStatusType>()
    const newCache = new Map<string, string>()
    const currentStatuses = get().statuses

    for (const [sessionID, status] of Object.entries(statuses)) {
      if (status.type === 'idle') continue
      newMap.set(sessionID, status)
      newCache.set(sessionID, getStatusHash(status))
    }

    for (const [sessionID, status] of currentStatuses.entries()) {
      if (!optimisticActiveTimers.has(sessionID) || sessionID in statuses) continue
      newMap.set(sessionID, status)
      newCache.set(sessionID, getStatusHash(status))
    }

    const currentCache = get().statusCache
    if (currentCache.size === newCache.size) {
      let unchanged = true
      for (const [sessionID, hash] of newCache.entries()) {
        if (currentCache.get(sessionID) !== hash) {
          unchanged = false
          break
        }
      }
      if (unchanged) return
    }

    set({ statuses: newMap, statusCache: newCache })
  },
  
  getStatus: (sessionID: string) => {
    return get().statuses.get(sessionID) || DEFAULT_STATUS
  },
  
  clearStatus: (sessionID: string) => {
    clearOptimisticActiveTimer(sessionID)
    const previousHash = get().statusCache.get(sessionID)
    if (!previousHash) return
    
    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      newMap.delete(sessionID)
      newCache.delete(sessionID)
      return { statuses: newMap, statusCache: newCache }
    })
  },
}))

export const useSessionStatusForSession = (sessionID: string | undefined): SessionStatusType => {
  return useSessionStatus((state) => 
    sessionID ? (state.statuses.get(sessionID) ?? DEFAULT_STATUS) : DEFAULT_STATUS
  )
}
