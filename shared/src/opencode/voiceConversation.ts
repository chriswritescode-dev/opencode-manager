import type { SessionMessageInfo, SessionStatus } from '@opencode/client'

import { assistantText } from './content'

/** Key under which the voice conversation instructions are stored on a session. */
export const VOICE_MODE_INSTRUCTION_KEY = 'voice-mode'

/** Session instructions that make every assistant reply suitable for reading aloud. */
export const VOICE_MODE_INSTRUCTIONS =
  'Every reply will be read aloud in full by text-to-speech. Write plain, conversational spoken sentences. Never include file paths, filenames, line numbers, URLs, code, commands, markdown, lists, tables or symbols; describe code by what it does instead. Say numbers naturally. Lead with the outcome and keep it to a few sentences unless asked for detail. End with a direct question when you need input. This changes only how replies are written, not how thoroughly you work or use tools, and it takes precedence over other formatting guidance while active.'

/**
 * The stage a hands-free voice conversation is currently in. `recording`
 * captures a message that is added to the session queue while the agent keeps
 * working, so it is separate from the `listening` stage that opens a new turn.
 */
export type VoicePhase =
  | 'off'
  | 'listening'
  | 'sending'
  | 'working'
  | 'speaking'
  | 'recording'
  | 'paused'

/** Why a paused voice conversation stopped listening. */
export type VoicePauseReason = 'user' | 'background' | 'no-speech' | 'error'

/** The reported status of a session, as a session transcript carries it. */
export type VoiceSessionStatus = SessionStatus['type']

/** Everything needed to resume or label a hands-free voice conversation. */
export interface VoiceConversationState {
  /** Current stage of the conversation loop. */
  phase: VoicePhase
  /** Why the conversation is paused, or null when it is not paused. */
  pauseReason: VoicePauseReason | null
  /** Message shown to the user after a failure, or null when there is none. */
  error: string | null
  /**
   * Id of the transcript message whose successors the conversation reads
   * aloud, or null when the whole transcript is in scope. Replies after it are
   * read one by one, including replies to messages queued during the turn.
   */
  baselineId: string | null
  /** Whether the session has reported being busy since the current turn was sent. */
  sawBusy: boolean
}

/** State of a voice conversation that is not running. */
export const INITIAL_VOICE_CONVERSATION_STATE: VoiceConversationState = {
  phase: 'off',
  pauseReason: null,
  error: null,
  baselineId: null,
  sawBusy: false,
}

/** A signal from the voice conversation controller or the session. */
export type VoiceConversationEvent =
  | { type: 'start'; busy: boolean; baselineId: string | null }
  | { type: 'transcript'; text: string }
  | { type: 'turn-sent'; baselineId: string | null }
  | { type: 'turn-started'; baselineId: string | null }
  | { type: 'send-failed'; message: string }
  | { type: 'status'; busy: boolean }
  | { type: 'speak-start' }
  | { type: 'speech-ended' }
  | { type: 'skip' }
  | { type: 'record' }
  | { type: 'record-ended' }
  | { type: 'turn-complete' }
  | { type: 'no-speech' }
  | { type: 'pause'; reason: VoicePauseReason }
  | { type: 'resume'; busy: boolean; baselineId: string | null }
  | { type: 'resume-speech' }
  | { type: 'error'; message: string }
  | { type: 'exit' }

/** An assistant message the conversation reads aloud. */
export interface VoiceSpokenMessage {
  /** Id of the assistant message. */
  id: string
  /** Trimmed spoken text of the message, which is never empty. */
  text: string
}

/** Session data used to decide whether the current turn is finished. */
export interface VoiceTurnCompletionInput {
  /** Reported session status for the active session. */
  status: VoiceSessionStatus
  /** Whether the session has reported being busy since the current turn started. */
  sawBusy: boolean
  /** Whether a message of the current turn was read aloud. */
  spoke: boolean
  /** Whether the session still holds prompts queued by the user. */
  hasPendingPrompts: boolean
  /** Whether an assistant message after the baseline is still streaming. */
  hasIncomplete: boolean
}

/** Inputs that determine the text shown for the voice conversation. */
export interface VoiceConversationLabelInput {
  /** Current stage of the conversation loop. */
  phase: VoicePhase
  /** Why the conversation is paused, or null when it is not paused. */
  pauseReason: VoicePauseReason | null
  /** Whether the session is waiting for the user to approve a tool. */
  pendingApproval: boolean
  /** Whether the current recording has stopped and is being finalized. */
  isEndpointing: boolean
  /** Whether a reading is held mid-reply after a pause. */
  isPlaybackPaused: boolean
  /** Whether the session is still working on the current turn. */
  sessionBusy: boolean
}

/**
 * Applies one voice conversation event to the loop state. Events that do not
 * apply to the current phase are ignored, and the previous state object is
 * returned unchanged so callers can skip re-rendering on no-ops.
 *
 * @param state The current conversation state.
 * @param event The event to apply.
 * @returns The next state, or the same state object when the event does not apply.
 */
export function reduceVoiceConversation(
  state: VoiceConversationState,
  event: VoiceConversationEvent,
): VoiceConversationState {
  switch (event.type) {
    case 'start':
      if (state.phase !== 'off') return state
      return event.busy
        ? {
            phase: 'working',
            pauseReason: null,
            error: null,
            sawBusy: true,
            baselineId: event.baselineId,
          }
        : {
            phase: 'listening',
            pauseReason: null,
            error: null,
            sawBusy: false,
            baselineId: null,
          }
    case 'transcript':
      if (state.phase !== 'listening') return state
      return event.text.trim()
        ? { ...state, phase: 'sending' }
        : { ...state, phase: 'paused', pauseReason: 'no-speech' }
    case 'turn-sent':
      if (state.phase !== 'sending') return state
      return { ...state, phase: 'working', sawBusy: false, baselineId: event.baselineId }
    case 'turn-started':
      if (state.phase !== 'listening') return state
      return { ...state, phase: 'working', sawBusy: true, baselineId: event.baselineId }
    case 'send-failed':
      if (state.phase !== 'sending' && state.phase !== 'working') return state
      return { ...state, phase: 'paused', pauseReason: 'error', error: event.message }
    case 'status':
      if (state.phase !== 'working') return state
      if (!event.busy || state.sawBusy) return state
      return { ...state, sawBusy: true }
    case 'speak-start':
      if (state.phase !== 'working') return state
      return { ...state, phase: 'speaking' }
    case 'speech-ended':
      if (state.phase !== 'speaking') return state
      return { ...state, phase: 'working' }
    case 'skip':
      if (state.phase !== 'speaking') return state
      return { ...state, phase: 'listening' }
    case 'record':
      if (state.phase !== 'working' && state.phase !== 'speaking') return state
      return { ...state, phase: 'recording' }
    case 'record-ended':
      if (state.phase !== 'recording') return state
      return { ...state, phase: 'working' }
    case 'turn-complete':
      if (state.phase !== 'working') return state
      return { ...state, phase: 'listening' }
    case 'no-speech':
      if (state.phase !== 'listening') return state
      return { ...state, phase: 'paused', pauseReason: 'no-speech' }
    case 'pause':
      if (state.phase === 'off' || state.phase === 'paused') return state
      return { ...state, phase: 'paused', pauseReason: event.reason }
    case 'resume':
      if (state.phase !== 'paused') return state
      return event.busy
        ? {
            ...state,
            phase: 'working',
            sawBusy: true,
            baselineId: event.baselineId,
            pauseReason: null,
            error: null,
          }
        : {
            ...state,
            phase: 'listening',
            sawBusy: false,
            baselineId: null,
            pauseReason: null,
            error: null,
          }
    case 'resume-speech':
      if (state.phase !== 'paused') return state
      return { ...state, phase: 'speaking', pauseReason: null, error: null }
    case 'error':
      if (state.phase === 'off') return state
      return { ...state, phase: 'paused', pauseReason: 'error', error: event.message }
    case 'exit':
      return INITIAL_VOICE_CONVERSATION_STATE
    default:
      return state
  }
}

/**
 * Returns the index of the first message the conversation may read. Messages at
 * or before the baseline are excluded; a null or unknown baseline leaves the
 * whole transcript in scope.
 *
 * @param messages The session transcript, oldest first.
 * @param baselineId Id of the message the turn starts after.
 * @returns The index of the first message in scope.
 */
function spokenWindowStart(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
): number {
  if (baselineId === null) return 0
  const baselineIndex = messages.findIndex((message) => message.id === baselineId)
  return baselineIndex === -1 ? 0 : baselineIndex + 1
}

/**
 * Lists every completed assistant message with text that the conversation has
 * not read yet, oldest first. Messages are read in the order they arrive, so a
 * user message inside the window does not end the scan: replies to prompts
 * queued during the turn are read as well.
 *
 * @param messages The session transcript, oldest first.
 * @param baselineId Id of the message the turn starts after.
 * @param spokenIds Ids of the messages already read aloud.
 * @returns The unread messages, oldest first.
 */
export function listUnspokenMessages(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
  spokenIds: ReadonlySet<string>,
): VoiceSpokenMessage[] {
  const unspoken: VoiceSpokenMessage[] = []
  for (let index = spokenWindowStart(messages, baselineId); index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined || message.type !== 'assistant') continue
    if (message.time.completed === undefined) continue
    if (spokenIds.has(message.id)) continue
    const text = assistantText(message.content, { stripThink: true }).trim()
    if (!text) continue
    unspoken.push({ id: message.id, text })
  }
  return unspoken
}

/**
 * Finds the message the conversation reads next: the oldest unread message that
 * has already completed.
 *
 * @param messages The session transcript, oldest first.
 * @param baselineId Id of the message the turn starts after.
 * @param spokenIds Ids of the messages already read aloud.
 * @returns The next message to read, or null when there is nothing to read.
 */
export function findNextUnspokenMessage(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
  spokenIds: ReadonlySet<string>,
): VoiceSpokenMessage | null {
  return listUnspokenMessages(messages, baselineId, spokenIds)[0] ?? null
}

/**
 * Decides whether any message of the current turn has been read aloud, which
 * lets a turn that produced a reply finish without ever reporting itself busy.
 *
 * @param messages The session transcript, oldest first.
 * @param baselineId Id of the message the turn starts after.
 * @param spokenIds Ids of the messages already read aloud.
 * @returns Whether a message after the baseline has been read.
 */
export function hasSpokenMessage(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
  spokenIds: ReadonlySet<string>,
): boolean {
  return messages
    .slice(spokenWindowStart(messages, baselineId))
    .some((message) => spokenIds.has(message.id))
}

/**
 * Reports whether the turn still produces an assistant message, which keeps the
 * turn open so the rest of a just-finished reply can still be read.
 *
 * @param messages The session transcript, oldest first.
 * @param baselineId Id of the message the turn starts after.
 * @returns Whether an assistant message after the baseline is still streaming.
 */
export function hasIncompleteAssistant(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
): boolean {
  return messages
    .slice(spokenWindowStart(messages, baselineId))
    .some((message) => message.type === 'assistant' && message.time.completed === undefined)
}

/**
 * Decides whether the session has finished the current turn. The turn is over
 * only when the session is idle, holds no prompt the user queued during it, and
 * has no reply still streaming, and when the turn showed activity — a busy
 * report or a message that was read aloud. Callers only ask once every eligible
 * message has been read, so an unread message keeps the turn open by
 * construction.
 *
 * @param input The session status and the turn's queued, streaming and spoken state.
 * @returns Whether the turn is over.
 */
export function isVoiceTurnComplete(input: VoiceTurnCompletionInput): boolean {
  return (
    input.status === 'idle' &&
    !input.hasPendingPrompts &&
    !input.hasIncomplete &&
    (input.sawBusy || input.spoke)
  )
}

/**
 * Produces the short status text shown on the status line while a voice
 * conversation is active. The text never names the next action, so a single
 * line describes the phase without growing or shifting the bar.
 *
 * @param input The current phase, pause reason and session signals.
 * @returns The status to display, or an empty string when voice mode is off.
 */
export function voiceConversationLabel(input: VoiceConversationLabelInput): string {
  const { phase, pauseReason, pendingApproval } = input

  switch (phase) {
    case 'listening':
      return 'Listening'
    case 'sending':
      return 'Sending…'
    case 'working':
      return pendingApproval ? 'Needs your approval' : 'Working'
    case 'speaking':
      return 'Speaking'
    case 'recording':
      return 'Adding to queue'
    case 'paused':
      if (pauseReason === 'no-speech') return "Didn't catch that"
      if (pauseReason === 'error') return 'Something went wrong'
      return 'Paused'
    case 'off':
      return ''
    default:
      return ''
  }
}

/**
 * Produces the action hint shown directly under the conversation orb, which
 * names what a tap does in the current phase and state.
 *
 * @param input The current phase, pause reason and session signals.
 * @returns The hint to display, or an empty string when the orb has no action.
 */
export function voiceConversationHint(input: VoiceConversationLabelInput): string {
  const { phase, pauseReason, pendingApproval, isEndpointing, isPlaybackPaused, sessionBusy } =
    input

  switch (phase) {
    case 'listening':
      return isEndpointing ? '' : 'Tap to send'
    case 'sending':
      return ''
    case 'working':
      return pendingApproval ? '' : 'Tap to add a message'
    case 'speaking':
      return sessionBusy ? 'Tap to add a message' : 'Tap to skip'
    case 'recording':
      return 'Tap to queue'
    case 'paused':
      if (pauseReason === 'no-speech') return 'Tap to talk'
      if (pauseReason === 'error') return 'Tap to retry'
      return isPlaybackPaused ? 'Tap to continue' : 'Tap to talk'
    case 'off':
      return ''
    default:
      return ''
  }
}
