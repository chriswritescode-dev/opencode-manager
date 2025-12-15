import { createContext } from 'react'

export type TTSState = 'idle' | 'loading' | 'playing' | 'error'

export interface TTSContextValue {
  speak: (text: string) => Promise<boolean>
  stop: () => void
  state: TTSState
  error: string | null
  currentText: string | null
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  isIdle: boolean
}

export const TTSContext = createContext<TTSContextValue | null>(null)
