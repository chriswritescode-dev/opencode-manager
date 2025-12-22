import { createContext } from 'react'

export type TTSState = 'idle' | 'loading' | 'playing' | 'error'

export interface TTSConfig {
  enabled: boolean
  provider: 'external' | 'builtin'
  endpoint: string
  apiKey: string
  voice: string
  model: string
  speed: number
}

export interface TTSContextValue {
  speak: (text: string) => Promise<boolean>
  speakWithConfig: (text: string, config: TTSConfig) => Promise<boolean>
  stop: () => void
  state: TTSState
  error: string | null
  currentText: string | null
  originalText: string | null
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  isIdle: boolean
}

export const TTSContext = createContext<TTSContextValue | null>(null)
