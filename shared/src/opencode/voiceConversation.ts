import type { SessionMessageInfo, SessionStatus } from '@opencode/client'

import { assistantText } from './content'

export const VOICE_MODE_INSTRUCTION_KEY = 'voice-mode'

export const VOICE_MODE_INSTRUCTIONS =
  'Every reply will be read aloud in full by text-to-speech. Write plain, conversational spoken sentences. Never include file paths, filenames, line numbers, URLs, code, commands, markdown, lists, tables or symbols; describe code by what it does instead. Say numbers naturally. Lead with the outcome and keep it to a few sentences unless asked for detail. End with a direct question when you need input. This changes only how replies are written, not how thoroughly you work or use tools, and it takes precedence over other formatting guidance while active.'

export type VoicePhase =
  | 'off'
  | 'listening'
  | 'sending'
  | 'working'
  | 'speaking'
  | 'recording'
  | 'paused'

export type VoicePauseReason = 'user' | 'background' | 'no-speech' | 'error'

export type VoiceFailureSource = 'capture' | 'send' | 'playback'

export type VoiceSessionStatus = SessionStatus['type']

export interface VoiceConversationState {
  phase: VoicePhase
  pauseReason: VoicePauseReason | null
  error: string | null
  failureSource: VoiceFailureSource | null
  baselineId: string | null
  sawBusy: boolean
}

export const INITIAL_VOICE_CONVERSATION_STATE: VoiceConversationState = {
  phase: 'off',
  pauseReason: null,
  error: null,
  failureSource: null,
  baselineId: null,
  sawBusy: false,
}

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
  | { type: 'error'; message: string; source: VoiceFailureSource }
  | { type: 'exit' }

export interface VoiceSpokenMessage {
  id: string
  text: string
}

export interface VoiceTurnCompletionInput {
  status: VoiceSessionStatus
  sawBusy: boolean
  spoke: boolean
  hasPendingPrompts: boolean
  hasIncomplete: boolean
}

export interface VoiceConversationLabelInput {
  phase: VoicePhase
  pauseReason: VoicePauseReason | null
  pendingApproval: boolean
  isEndpointing: boolean
  isPlaybackPaused: boolean
  sessionBusy: boolean
  error?: string | null
  failureSource?: VoiceFailureSource | null
  isStartingCapture?: boolean
}

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
            failureSource: null,
            sawBusy: true,
            baselineId: event.baselineId,
          }
        : {
            phase: 'listening',
            pauseReason: null,
            error: null,
            failureSource: null,
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
      return {
        ...state,
        phase: 'paused',
        pauseReason: 'error',
        error: event.message,
        failureSource: 'send',
      }
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
            failureSource: null,
          }
        : {
            ...state,
            phase: 'listening',
            sawBusy: false,
            baselineId: null,
            pauseReason: null,
            error: null,
            failureSource: null,
          }
    case 'resume-speech':
      if (state.phase !== 'paused') return state
      return {
        ...state,
        phase: 'speaking',
        pauseReason: null,
        error: null,
        failureSource: null,
      }
    case 'error':
      if (state.phase === 'off') return state
      return {
        ...state,
        phase: 'paused',
        pauseReason: 'error',
        error: event.message,
        failureSource: event.source,
      }
    case 'exit':
      return INITIAL_VOICE_CONVERSATION_STATE
    default:
      return state
  }
}

function spokenWindowStart(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
): number {
  if (baselineId === null) return 0
  const baselineIndex = messages.findIndex((message) => message.id === baselineId)
  return baselineIndex === -1 ? 0 : baselineIndex + 1
}

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

export function findNextUnspokenMessage(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
  spokenIds: ReadonlySet<string>,
): VoiceSpokenMessage | null {
  return listUnspokenMessages(messages, baselineId, spokenIds)[0] ?? null
}

export function hasSpokenMessage(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
  spokenIds: ReadonlySet<string>,
): boolean {
  return messages
    .slice(spokenWindowStart(messages, baselineId))
    .some((message) => spokenIds.has(message.id))
}

export function hasIncompleteAssistant(
  messages: readonly SessionMessageInfo[],
  baselineId: string | null,
): boolean {
  return messages
    .slice(spokenWindowStart(messages, baselineId))
    .some((message) => message.type === 'assistant' && message.time.completed === undefined)
}

export function isVoiceTurnComplete(input: VoiceTurnCompletionInput): boolean {
  return (
    input.status === 'idle' &&
    !input.hasPendingPrompts &&
    !input.hasIncomplete &&
    (input.sawBusy || input.spoke)
  )
}

export function voiceConversationLabel(input: VoiceConversationLabelInput): string {
  const { phase, pauseReason, pendingApproval, error, isStartingCapture } = input

  switch (phase) {
    case 'listening':
      return isStartingCapture ? 'Starting…' : 'Listening'
    case 'sending':
      return 'Sending…'
    case 'working':
      return pendingApproval ? 'Needs your approval' : 'Working'
    case 'speaking':
      return 'Speaking'
    case 'recording':
      return isStartingCapture ? 'Starting…' : 'Adding to queue'
    case 'paused':
      if (pauseReason === 'no-speech') return "Didn't catch that"
      if (pauseReason === 'error') return error?.trim() || 'Something went wrong'
      return 'Paused'
    case 'off':
      return ''
    default:
      return ''
  }
}

export function voiceConversationHint(input: VoiceConversationLabelInput): string {
  const {
    phase,
    pauseReason,
    pendingApproval,
    isEndpointing,
    isPlaybackPaused,
    sessionBusy,
    failureSource,
    isStartingCapture,
  } = input

  switch (phase) {
    case 'listening':
      if (isStartingCapture) return ''
      return isEndpointing ? '' : 'Tap to send'
    case 'sending':
      return ''
    case 'working':
      return pendingApproval ? '' : 'Tap to add a message'
    case 'speaking':
      return sessionBusy ? 'Tap to add a message' : 'Tap to skip'
    case 'recording':
      return isStartingCapture ? '' : 'Tap to queue'
    case 'paused':
      if (pauseReason === 'no-speech') return 'Tap to talk'
      if (pauseReason === 'error') {
        return failureSource === 'capture'
          ? 'Allow microphone access, then tap to retry'
          : 'Tap to retry'
      }
      return isPlaybackPaused ? 'Tap to continue' : 'Tap to talk'
    case 'off':
      return ''
    default:
      return ''
  }
}
