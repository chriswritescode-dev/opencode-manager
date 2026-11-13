import { createContext, useContext } from 'react'
import type { SessionInboxInfo, SessionMessageInfo, VoiceSessionStatus } from '@opencode-manager/shared/opencode'

export interface SessionTranscriptSnapshot {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: VoiceSessionStatus
}

const EMPTY_TRANSCRIPT_SNAPSHOT: SessionTranscriptSnapshot = { messages: [], pending: [], status: 'idle' }

export const SessionTranscriptContext = createContext<SessionTranscriptSnapshot>(EMPTY_TRANSCRIPT_SNAPSHOT)

export function useSessionTranscriptSnapshot(): SessionTranscriptSnapshot {
  return useContext(SessionTranscriptContext)
}
