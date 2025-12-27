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
    
    set((state) => {
      const newMap = new Map(state.statuses)
      const newCache = new Map(state.statusCache)
      newMap.set(sessionID, status)
      newCache.set(sessionID, hash)
      return { statuses: newMap, statusCache: newCache }
    })
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
  const status = useSessionStatus((state) => 
    sessionID ? state.statuses.get(sessionID) : undefined
  )
  return status || DEFAULT_STATUS
}
