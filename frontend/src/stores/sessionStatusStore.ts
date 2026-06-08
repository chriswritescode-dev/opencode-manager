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
  replaceStatuses: (statuses: Record<string, SessionStatusType>) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }

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

  replaceStatuses: (statuses: Record<string, SessionStatusType>) => {
    const newMap = new Map<string, SessionStatusType>()
    const newCache = new Map<string, string>()

    for (const [sessionID, status] of Object.entries(statuses)) {
      if (status.type === 'idle') continue
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

export function beginOptimisticBusy(sessionID: string): SessionStatusType {
  const { getStatus, setStatus } = useSessionStatus.getState()
  const previous = getStatus(sessionID)
  setStatus(sessionID, { type: 'busy' })
  return previous
}

export function rollbackOptimisticBusy(
  sessionID: string,
  previous: SessionStatusType,
): void {
  useSessionStatus.getState().setStatus(sessionID, previous)
}
