import { create } from 'zustand'

export interface SendError {
  sessionID: string
  title: string
  message: string
  detail?: string
  failedPrompt?: string
}

interface SendErrorStore {
  errors: Record<string, SendError>
  queuedPrompts: Record<string, string>
  setError: (err: SendError) => void
  setQueuedPrompt: (sessionID: string, prompt: string) => void
  clearQueuedPrompt: (sessionID: string) => void
  failQueuedPrompt: (err: Omit<SendError, 'failedPrompt'>) => void
  clearError: (sessionID: string) => void
  getError: (sessionID: string) => SendError | null
}

export const useSendErrorStore = create<SendErrorStore>((set, get) => ({
  errors: {},
  queuedPrompts: {},
  setError: (err: SendError) => {
    set((state) => ({
      errors: { ...state.errors, [err.sessionID]: err },
    }))
  },
  setQueuedPrompt: (sessionID: string, prompt: string) => {
    set((state) => ({
      queuedPrompts: { ...state.queuedPrompts, [sessionID]: prompt },
    }))
  },
  clearQueuedPrompt: (sessionID: string) => {
    set((state) => {
      const queuedPrompts = { ...state.queuedPrompts }
      delete queuedPrompts[sessionID]
      return { queuedPrompts }
    })
  },
  failQueuedPrompt: (err: Omit<SendError, 'failedPrompt'>) => {
    set((state) => {
      const failedPrompt = state.queuedPrompts[err.sessionID]
      if (!failedPrompt) return state
      const queuedPrompts = { ...state.queuedPrompts }
      delete queuedPrompts[err.sessionID]
      return {
        errors: {
          ...state.errors,
          [err.sessionID]: { ...err, failedPrompt },
        },
        queuedPrompts,
      }
    })
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
