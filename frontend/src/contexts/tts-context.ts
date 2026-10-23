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
  /**
   * Primes the shared audio element inside a user gesture so a reply that
   * arrives later is allowed to start playing. Must be called synchronously from
   * the gesture handler. Does nothing while audio is already in use or once the
   * element is primed, and does nothing for the builtin Web Speech provider,
   * which keeps its own gesture requirement.
   */
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
