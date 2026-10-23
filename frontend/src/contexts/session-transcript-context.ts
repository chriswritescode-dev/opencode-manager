import { createContext, useContext } from 'react'
import type { SessionInboxInfo, SessionMessageInfo, VoiceSessionStatus } from '@opencode-manager/shared/opencode'

/** The live session transcript a voice conversation reads while it runs. */
export interface SessionTranscriptSnapshot {
  /** The session transcript, oldest first. */
  messages: SessionMessageInfo[]
  /** Prompts the user queued on the session that have not started yet. */
  pending: SessionInboxInfo[]
  /** Reported status of the conversation's session. */
  status: VoiceSessionStatus
}

const EMPTY_TRANSCRIPT_SNAPSHOT: SessionTranscriptSnapshot = { messages: [], pending: [], status: 'idle' }

/** Transcript snapshot published to the composer's voice conversation. */
export const SessionTranscriptContext = createContext<SessionTranscriptSnapshot>(EMPTY_TRANSCRIPT_SNAPSHOT)

/**
 * Reads the session transcript published by the surrounding provider, falling
 * back to an empty idle transcript when there is none.
 */
export function useSessionTranscriptSnapshot(): SessionTranscriptSnapshot {
  return useContext(SessionTranscriptContext)
}
