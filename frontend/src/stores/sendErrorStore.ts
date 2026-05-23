import { create } from 'zustand'

export interface SendError {
  sessionID: string
  title: string
  message: string
  detail?: string
}

interface SendErrorStore {
  errors: Record<string, SendError>
  setError: (err: SendError) => void
  clearError: (sessionID: string) => void
  getError: (sessionID: string) => SendError | null
}

export const useSendErrorStore = create<SendErrorStore>((set, get) => ({
  errors: {},
  setError: (err: SendError) => {
    set((state) => ({
      errors: { ...state.errors, [err.sessionID]: err },
    }))
  },
  clearError: (sessionID: string) => {
    set((state) => {
      const newErrors = { ...state.errors }
      delete newErrors[sessionID]
      return { errors: newErrors }
    })
  },
  getError: (sessionID: string) => {
    return get().errors[sessionID] || null
  },
}))
