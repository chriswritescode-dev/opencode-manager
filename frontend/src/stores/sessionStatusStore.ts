import { create } from 'zustand'

export type SessionStatusType = 
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number }

interface SessionStatusStore {
  statuses: Map<string, SessionStatusType>
  setStatus: (sessionID: string, status: SessionStatusType) => void
  getStatus: (sessionID: string) => SessionStatusType
  clearStatus: (sessionID: string) => void
}

const DEFAULT_STATUS: SessionStatusType = { type: 'idle' }

export const useSessionStatus = create<SessionStatusStore>((set, get) => ({
  statuses: new Map(),
  
  setStatus: (sessionID: string, status: SessionStatusType) => {
    set((state) => {
      const newMap = new Map(state.statuses)
      newMap.set(sessionID, status)
      return { statuses: newMap }
    })
  },
  
  getStatus: (sessionID: string) => {
    return get().statuses.get(sessionID) || DEFAULT_STATUS
  },
  
  clearStatus: (sessionID: string) => {
    set((state) => {
      const newMap = new Map(state.statuses)
      newMap.delete(sessionID)
      return { statuses: newMap }
    })
  },
}))

export const useSessionStatusForSession = (sessionID: string | undefined): SessionStatusType => {
  const status = useSessionStatus((state) => 
    sessionID ? state.statuses.get(sessionID) : undefined
  )
  return status || DEFAULT_STATUS
}
