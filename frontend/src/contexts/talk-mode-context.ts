import { createContext } from 'react'

export type TalkModeState =
  | 'off'
  | 'initializing'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

export interface TalkModeContextValue {
  state: TalkModeState
  error: string | null
  userTranscript: string | null
  agentResponse: string | null
  userSpeaking: boolean
  sessionID: string | null
  start: (sessionID: string, opcodeUrl: string, directory?: string) => Promise<void>
  stop: () => void
  isEnabled: boolean
}

export const TalkModeContext = createContext<TalkModeContextValue | null>(null)
