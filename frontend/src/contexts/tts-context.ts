import { createContext } from 'react'

export type TTSState = 'idle' | 'loading' | 'playing' | 'error'

export type TTSEndReason = 'completed' | 'stopped' | 'error'

export interface SpeakMessageOptions {
  onEnd?: (reason: TTSEndReason, error?: string) => void
}

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
  speakMessage: (messageId: string, text: string, options?: SpeakMessageOptions) => Promise<boolean>
  queueMessage: (messageId: string, text: string) => void
  unlock: () => void
  stop: () => void
  pause: () => void
  resume: () => void
  state: TTSState
  error: string | null
  currentText: string | null
  originalText: string | null
  activeMessageId: string | null
  isEnabled: boolean
  isPlaying: boolean
  isLoading: boolean
  isIdle: boolean
  isPaused: boolean
}

export const TTSContext = createContext<TTSContextValue | null>(null)
