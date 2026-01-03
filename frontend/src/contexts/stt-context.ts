import { createContext } from 'react'

export type STTState = 'idle' | 'recording' | 'transcribing' | 'error'

export interface STTConfig {
  enabled: boolean
  model: string
  language?: string
  autoSubmit: boolean
}

export interface STTContextValue {
  startRecording: () => Promise<void>
  stopRecording: () => Promise<string | null>
  cancelRecording: () => void
  state: STTState
  error: string | null
  isEnabled: boolean
  isRecording: boolean
  isTranscribing: boolean
  isIdle: boolean
  recordingDuration: number
}

export const STTContext = createContext<STTContextValue | null>(null)
