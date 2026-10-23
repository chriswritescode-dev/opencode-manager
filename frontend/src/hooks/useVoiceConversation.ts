import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  INITIAL_VOICE_CONVERSATION_STATE,
  VOICE_MODE_INSTRUCTIONS,
  VOICE_MODE_INSTRUCTION_KEY,
  VOICE_NO_SPEECH_TIMEOUT_MS,
  findNextUnspokenMessage,
  hasIncompleteAssistant,
  hasSpokenMessage,
  isVoiceTurnComplete,
  listUnspokenMessages,
  reduceVoiceConversation,
  voiceConversationHint,
  voiceConversationLabel,
} from '@opencode-manager/shared/opencode'
import type {
  SessionInboxInfo,
  SessionMessageInfo,
  VoicePauseReason,
  VoicePhase,
  VoiceSessionStatus,
  VoiceSpokenMessage,
} from '@opencode-manager/shared/opencode'
import {
  listSessionInstructionKeys,
  putSessionInstruction,
  removeSessionInstruction,
} from '@/api/opencode'
import { useSTT } from '@/hooks/useSTT'
import { useTTS } from '@/hooks/useTTS'
import { sanitizeForTTS } from '@/lib/utils'
import type { SttEndOfSpeechReason } from '@/lib/webSpeechRecognizer'

/** Everything the voice conversation loop needs from the view that owns it. */
export interface UseVoiceConversationInput {
  /** Id of the session the conversation belongs to. */
  sessionID: string
  /** Server that owns the session, when it is not the local one. */
  serverId?: string
  /** The session transcript, oldest first. */
  messages: SessionMessageInfo[]
  /** Prompts the user queued on the session that have not started yet. */
  pending: SessionInboxInfo[]
  /** Reported session status for the conversation's session. */
  status: VoiceSessionStatus
  /** Whether the session is waiting for the user to approve a tool or a form. */
  hasPendingApproval: boolean
  /** Silence after speech, in milliseconds, that ends a turn. */
  pauseMs: number
  /** Sends one transcribed turn to the session, queueing it while the session is busy. */
  sendTurn: (text: string, options: { busy: boolean }) => Promise<void>
  /** Aborts the reply that the session is currently producing. */
  interrupt: () => Promise<void>
  /** Hands a captured transcript to the composer for editing. */
  onEditInTextBox: (text: string) => void
}

/** The state, status and controls a voice conversation view renders. */
export interface VoiceConversationController {
  /** Whether voice mode is running, including while paused. */
  isActive: boolean
  /** Current stage of the conversation loop. */
  phase: VoicePhase
  /** Short status text for the conversation. */
  label: string
  /** Action hint shown under the orb for the current phase, or an empty string. */
  hint: string
  /** Action the orb performs in the current phase, for assistive technology. */
  orbLabel: string
  /** Live transcript of the current dictation, or an empty string. */
  liveTranscript: string
  /** Whether the finished or in-progress transcript can be moved into the composer. */
  canEditInTextBox: boolean
  /** Whether voice mode is running and the agent can be stopped. */
  canStopAgent: boolean
  /** Whether the conversation is paused while a reply was held mid-read. */
  hasHeldReading: boolean
  /** Whether the live capture will end the turn on its own after a pause in speech. */
  isEndpointing: boolean
  /** Notice for the user, such as unavailable speech-to-text, or null when there is none. */
  notice: string | null
  /** Starts the conversation loop. */
  start: () => void
  /** Stops the conversation loop and removes its session instruction. */
  exit: () => void
  /** Stops the conversation loop and hands its transcript to the composer. */
  editInTextBox: () => void
  /** Handles a tap on the conversation orb for the current phase. */
  tapOrb: () => void
  /** Pauses the conversation loop until the user resumes it. */
  pause: () => void
  /** Resumes the conversation loop, continuing a reply that was held mid-read. */
  resume: () => void
  /** Aborts the reply the session is currently producing. */
  stopAgent: () => void
}

interface VoiceConversationLatest {
  sessionID: string
  serverId?: string
  messages: SessionMessageInfo[]
  status: VoiceSessionStatus
  sendTurn: (text: string, options: { busy: boolean }) => Promise<void>
  interrupt: () => Promise<void>
  onEditInTextBox: (text: string) => void
  tts: ReturnType<typeof useTTS>
}

interface TimeoutRef {
  current: ReturnType<typeof setTimeout> | null
}

const STT_UNAVAILABLE_NOTICE = 'Turn on speech-to-text in Voice settings'

const VOICE_INSTRUCTIONS_NOTICE = 'Replies may include code and paths'

const TURN_NOT_DELIVERED_MESSAGE = "The message didn't reach the session"

const TURN_NOT_DELIVERED_TIMEOUT_MS = 3000

const TURN_FINAL_MESSAGE_GRACE_MS = 1500

const SPEAKING_WATCHDOG_BASE_MS = 15_000

const SPEAKING_WATCHDOG_PER_CHARACTER_MS = 80

const SPEAKING_WATCHDOG_MAX_MS = 180_000

const SPEAKING_STALLED_MESSAGE = 'Reading the reply stopped responding'

const REPLY_READ_FAILED_MESSAGE = 'Reading the reply failed'

const STT_FAILED_MESSAGE = 'Speech recognition failed'

const LISTENING_MAX_TURN_MS = 120_000

const STT_STOP_TIMEOUT_MS = 10_000

const STT_PLACEHOLDERS = ['Recording...', 'Processing...']

const ORB_LABELS: Record<VoicePhase, string> = {
  off: 'Voice conversation',
  listening: 'Send now',
  sending: 'Sending',
  working: 'Add a message',
  speaking: 'Skip reply',
  recording: 'Send to queue',
  paused: 'Resume voice conversation',
}

/**
 * Cancels the timeout held by a ref and releases the handle.
 *
 * @param ref The ref that holds the pending timeout, if any.
 */
function clearTimeoutRef(ref: TimeoutRef): void {
  if (ref.current === null) return
  clearTimeout(ref.current)
  ref.current = null
}

/**
 * Returns the id of the newest message of any role, which is the baseline for a
 * turn that begins now, so an earlier reply is never spoken again.
 *
 * @param messages The session transcript, oldest first.
 * @returns The newest message id, or null when the transcript is empty.
 */
function latestMessageBaseline(messages: readonly SessionMessageInfo[]): string | null {
  return messages[messages.length - 1]?.id ?? null
}

/**
 * Returns the id of the newest user message, which is the baseline for a turn
 * that starts or resumes with a reply already in flight.
 *
 * @param messages The session transcript, oldest first.
 * @returns The newest user message id, or null when the transcript has none.
 */
function currentTurnBaseline(messages: readonly SessionMessageInfo[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'user') return message.id
  }
  return null
}

/**
 * Returns the dictated words the user can still act on. The web speech engines
 * publish placeholders while they capture and transcribe, and those stand in
 * for audio rather than words, so they count as no capture at all.
 *
 * @param text The live transcript or the captured turn text.
 * @returns The trimmed text, or an empty string for a placeholder.
 */
function capturedWords(text: string): string {
  const trimmed = text.trim()
  return STT_PLACEHOLDERS.includes(trimmed) ? '' : trimmed
}

/**
 * Describes a failed request to the user.
 *
 * @param error The rejection value.
 * @returns The error message, or a generic fallback.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The turn could not be sent'
}

/**
 * Fires the short vibration the native app uses as an impact haptic.
 */
function fireImpactHaptic(): void {
  if (typeof navigator === 'undefined') return
  navigator.vibrate?.(10)
}

/**
 * Removes the voice instruction once any pending install has settled, skipping
 * the removal when the conversation restarted or exited in the meantime.
 *
 * @param sessionID The session that received the instruction.
 * @param serverId The server that owns the session.
 * @param epochRef The ref holding the live instruction epoch.
 * @param epoch The epoch captured when the conversation was left.
 * @param pendingPut The install request that must settle first, if any.
 */
function removeVoiceInstructionAfterInstall(
  sessionID: string,
  serverId: string | undefined,
  epochRef: RefObject<number>,
  epoch: number,
  pendingPut: Promise<void> | null,
): void {
  const settledInstall = pendingPut ?? Promise.resolve()
  void settledInstall
    .then(() => {
      if (epochRef.current !== epoch) return
      return removeSessionInstruction(sessionID, VOICE_MODE_INSTRUCTION_KEY, serverId)
    })
    .catch(() => {})
}

/**
 * Names the action the orb performs, which changes while a reply is read and
 * while a reading is held after a pause.
 *
 * @param phase The current stage of the conversation loop.
 * @param canStopAgent Whether the agent can be stopped from the orb.
 * @param hasHeldReading Whether the conversation is paused mid-reply.
 * @returns The accessibility label for the orb.
 */
function orbLabelFor(
  phase: VoicePhase,
  canStopAgent: boolean,
  hasHeldReading: boolean,
): string {
  if (phase === 'speaking') return canStopAgent ? 'Add a message' : ORB_LABELS.speaking
  if (phase === 'paused') return hasHeldReading ? 'Continue reading' : ORB_LABELS.paused
  return ORB_LABELS[phase]
}

/**
 * Runs a hands-free voice conversation for one session: listens through
 * speech-to-text, sends each finished turn, reads every assistant message the
 * turn produces as soon as it completes — including replies to messages queued
 * while the agent works — and listens again once the turn is over. When
 * text-to-speech is unavailable each reply is marked as heard without being
 * spoken, so the loop keeps its rhythm but stays silent. The loop pauses on a
 * hidden page, on a turn that produced no speech, on a failed send and on a
 * session that needs approval, and leaves the voice instruction on the session
 * only while it runs.
 *
 * @param input The session, its transcript, status and queued prompts, and the
 * turn controls owned by the caller.
 * @returns The conversation state, its status, its orb labels and the controls for it.
 */
export function useVoiceConversation(
  input: UseVoiceConversationInput,
): VoiceConversationController {
  const {
    sessionID,
    serverId,
    messages,
    pending,
    status,
    hasPendingApproval,
    pauseMs,
    sendTurn,
    interrupt,
    onEditInTextBox,
  } = input
  const tts = useTTS()
  const stt = useSTT()

  const [state, dispatch] = useReducer(
    reduceVoiceConversation,
    INITIAL_VOICE_CONVERSATION_STATE,
  )
  const [playbackHeld, setPlaybackHeld] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const phaseRef = useRef(state.phase)
  const baselineIdRef = useRef(state.baselineId)
  const previousPhaseRef = useRef<VoicePhase>('off')
  const previousSttErrorRef = useRef(false)
  const activeSessionIDRef = useRef<string | null>(null)
  const endTurnInFlightRef = useRef(false)
  const turnGenerationRef = useRef(0)
  const instructionPutRef = useRef<Promise<void> | null>(null)
  const instructionEpochRef = useRef(0)
  const noDeliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speakingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speakingTextRef = useRef('')
  const speakingIdRef = useRef<string | null>(null)
  const spokenIdsRef = useRef<Set<string>>(new Set())
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTurnBaselineRef = useRef<string | null>(null)
  const playbackHeldRef = useRef(false)
  const endTurnRef = useRef<((finalText?: string) => Promise<void>) | null>(null)
  const endRecordingRef = useRef<((finalText?: string) => Promise<void>) | null>(null)
  const captureSettleRef = useRef<Array<() => void>>([])
  const exitInFlightRef = useRef(false)
  const speakTokenRef = useRef(0)
  const sttRef = useRef<ReturnType<typeof useSTT> | null>(null)
  const latestRef = useRef<VoiceConversationLatest>({
    sessionID,
    serverId,
    messages,
    status,
    sendTurn,
    interrupt,
    onEditInTextBox,
    tts,
  })

  const pendingPromptCount = pending.length
  const canStart = stt.isEnabled && stt.isSupported
  const isActive = state.phase !== 'off'

  const invalidateTurn = useCallback(() => {
    turnGenerationRef.current += 1
    endTurnInFlightRef.current = false
  }, [])

  const setHeldPlayback = useCallback((held: boolean) => {
    playbackHeldRef.current = held
    setPlaybackHeld(held)
  }, [])

  useEffect(() => {
    phaseRef.current = state.phase
    baselineIdRef.current = state.baselineId
  })

  useEffect(() => {
    latestRef.current = {
      sessionID,
      serverId,
      messages,
      status,
      sendTurn,
      interrupt,
      onEditInTextBox,
      tts,
    }
    sttRef.current = stt
  })

  useEffect(() => {
    if (stt.isRecording || stt.isProcessing) return
    const pendingSettles = captureSettleRef.current
    captureSettleRef.current = []
    for (const settle of pendingSettles) settle()
  }, [stt.isRecording, stt.isProcessing])

  const waitForCaptureSettled = useCallback(
    (): Promise<void> =>
      new Promise((resolve) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const finish = () => {
          if (settled) return
          settled = true
          if (timer !== null) clearTimeout(timer)
          captureSettleRef.current = captureSettleRef.current.filter((entry) => entry !== finish)
          resolve()
        }
        captureSettleRef.current.push(finish)
        timer = setTimeout(finish, STT_STOP_TIMEOUT_MS)
      }),
    [],
  )

  const stopCapture = useCallback(async (): Promise<string> => {
    const current = sttRef.current
    if (!current) return ''
    if (!current.isRecording && !current.isProcessing) return capturedWords(current.transcript)
    current.stopRecording()
    await waitForCaptureSettled()
    return capturedWords(sttRef.current?.transcript ?? '')
  }, [waitForCaptureSettled])

  const handleEndOfSpeech = useCallback(
    (reason: SttEndOfSpeechReason, finalText: string) => {
      if (exitInFlightRef.current) return
      const phase = phaseRef.current
      if (phase !== 'listening' && phase !== 'recording') return
      if (reason === 'no-speech') {
        sttRef.current?.abortRecording()
        dispatch(phase === 'recording' ? { type: 'record-ended' } : { type: 'no-speech' })
        return
      }
      if (phase === 'recording') void endRecordingRef.current?.(finalText)
      else void endTurnRef.current?.(finalText)
    },
    [],
  )

  const failCapture = useCallback((message: string) => {
    const phase = phaseRef.current
    if (phase !== 'listening' && phase !== 'recording') return
    phaseRef.current = 'paused'
    dispatch({ type: 'error', message, source: 'capture' })
  }, [])

  const startCapture = useCallback(async () => {
    const current = sttRef.current
    if (!current || !current.isEnabled || !current.isSupported) return
    const generation = turnGenerationRef.current
    const phase = phaseRef.current
    const started = await current.startRecording({
      endpointing: { pauseMs, noSpeechTimeoutMs: VOICE_NO_SPEECH_TIMEOUT_MS },
      onEndOfSpeech: handleEndOfSpeech,
    })
    if (started) return
    if (turnGenerationRef.current !== generation) return
    if (phaseRef.current !== phase) return
    failCapture(sttRef.current?.error ?? STT_FAILED_MESSAGE)
  }, [pauseMs, handleEndOfSpeech, failCapture])

  const endTurn = useCallback(
    async (finalText?: string) => {
      if (exitInFlightRef.current) return
      if (phaseRef.current !== 'listening' || endTurnInFlightRef.current) return
      const generation = turnGenerationRef.current
      endTurnInFlightRef.current = true
      try {
        const text =
          finalText === undefined ? await stopCapture() : capturedWords(finalText)
        if (turnGenerationRef.current !== generation) return
        if (phaseRef.current !== 'listening') return
        dispatch({ type: 'transcript', text })
        if (!text) return
        const latest = latestRef.current
        const baselineId = latestMessageBaseline(latest.messages)
        fireImpactHaptic()
        try {
          await latest.sendTurn(text, { busy: latest.status !== 'idle' })
        } catch (error) {
          if (turnGenerationRef.current !== generation) return
          dispatch({ type: 'send-failed', message: errorMessage(error) })
          return
        }
        if (turnGenerationRef.current !== generation) return
        dispatch({ type: 'turn-sent', baselineId })
      } finally {
        if (turnGenerationRef.current === generation) {
          endTurnInFlightRef.current = false
        }
      }
    },
    [stopCapture],
  )

  const endRecording = useCallback(
    async (finalText?: string) => {
      if (exitInFlightRef.current) return
      if (phaseRef.current !== 'recording' || endTurnInFlightRef.current) return
      const generation = turnGenerationRef.current
      endTurnInFlightRef.current = true
      try {
        const text =
          finalText === undefined ? await stopCapture() : capturedWords(finalText)
        if (turnGenerationRef.current !== generation) return
        if (phaseRef.current !== 'recording') return
        dispatch({ type: 'record-ended' })
        if (!text) return
        const latest = latestRef.current
        fireImpactHaptic()
        try {
          await latest.sendTurn(text, { busy: latest.status !== 'idle' })
        } catch (error) {
          if (turnGenerationRef.current !== generation) return
          dispatch({ type: 'send-failed', message: errorMessage(error) })
        }
      } finally {
        if (turnGenerationRef.current === generation) {
          endTurnInFlightRef.current = false
        }
      }
    },
    [stopCapture],
  )

  useEffect(() => {
    endTurnRef.current = endTurn
    endRecordingRef.current = endRecording
  })

  useEffect(() => {
    const previousPhase = previousPhaseRef.current
    previousPhaseRef.current = state.phase
    if (state.phase !== 'listening' && state.phase !== 'recording') return
    if (previousPhase === state.phase) return
    const current = sttRef.current
    if (current?.isError) current.abortRecording()
    void startCapture()
  }, [state.phase, startCapture])

  const clearWorkingTimers = useCallback(() => {
    clearTimeoutRef(noDeliveryTimerRef)
    clearTimeoutRef(finalGraceTimerRef)
  }, [])

  const clearSpeakingWatchdog = useCallback(() => {
    clearTimeoutRef(speakingWatchdogRef)
  }, [])

  const clearListeningTimers = useCallback(() => {
    clearTimeoutRef(noSpeechTimerRef)
    clearTimeoutRef(maxTurnTimerRef)
  }, [])

  const speakMessage = useCallback(
    (message: VoiceSpokenMessage) => {
      const token = ++speakTokenRef.current
      speakingTextRef.current = message.text
      speakingIdRef.current = message.id
      spokenIdsRef.current.add(message.id)
      void latestRef.current.tts.speakMessage(message.id, message.text, {
        onEnd: (reason) => {
          if (speakTokenRef.current !== token) return
          if (reason === 'error') {
            speakTokenRef.current += 1
            speakingIdRef.current = null
            dispatch({ type: 'error', message: REPLY_READ_FAILED_MESSAGE, source: 'playback' })
            return
          }
          speakingIdRef.current = null
          if (playbackHeldRef.current) {
            setHeldPlayback(false)
            return
          }
          dispatch({ type: 'speech-ended' })
        },
      })
    },
    [setHeldPlayback],
  )

  useEffect(() => {
    if (state.phase !== 'speaking') return
    const estimated =
      SPEAKING_WATCHDOG_BASE_MS +
      speakingTextRef.current.length * SPEAKING_WATCHDOG_PER_CHARACTER_MS
    speakingWatchdogRef.current = setTimeout(() => {
      speakingWatchdogRef.current = null
      speakTokenRef.current += 1
      speakingIdRef.current = null
      latestRef.current.tts.stop()
      dispatch({ type: 'error', message: SPEAKING_STALLED_MESSAGE, source: 'playback' })
    }, Math.min(SPEAKING_WATCHDOG_MAX_MS, estimated))
    return clearSpeakingWatchdog
  }, [state.phase, clearSpeakingWatchdog])

  const interimText = capturedWords(stt.interimTranscript)
  const turnTextValue = capturedWords(stt.transcript)

  useEffect(() => {
    const isCapturing = state.phase === 'listening' || state.phase === 'recording'
    if (!isCapturing || !stt.isRecording || stt.isEndpointing) {
      clearListeningTimers()
      return
    }
    if (stt.isExternalProvider || interimText || turnTextValue) {
      clearTimeoutRef(noSpeechTimerRef)
    } else if (noSpeechTimerRef.current === null) {
      noSpeechTimerRef.current = setTimeout(() => {
        noSpeechTimerRef.current = null
        handleEndOfSpeech('no-speech', '')
      }, VOICE_NO_SPEECH_TIMEOUT_MS)
    }
    if (maxTurnTimerRef.current === null) {
      maxTurnTimerRef.current = setTimeout(() => {
        maxTurnTimerRef.current = null
        void (state.phase === 'recording'
          ? endRecordingRef.current?.()
          : endTurnRef.current?.())
      }, LISTENING_MAX_TURN_MS)
    }
  }, [
    state.phase,
    stt.isRecording,
    stt.isEndpointing,
    stt.isExternalProvider,
    interimText,
    turnTextValue,
    handleEndOfSpeech,
    clearListeningTimers,
  ])

  useEffect(() => {
    if (state.phase !== 'working') {
      clearWorkingTimers()
      return
    }
    if (status !== 'idle' && !state.sawBusy) dispatch({ type: 'status', busy: true })
    if (hasPendingApproval) {
      clearWorkingTimers()
      return
    }
    const spokenIds = spokenIdsRef.current
    const unspoken = listUnspokenMessages(messages, state.baselineId, spokenIds)
    const readable = latestRef.current.tts.isEnabled
      ? unspoken.find((message) => sanitizeForTTS(message.text).trim() !== '')
      : undefined
    if (readable) {
      clearWorkingTimers()
      dispatch({ type: 'speak-start' })
      speakMessage(readable)
      return
    }
    if (unspoken.length > 0) {
      clearWorkingTimers()
      for (const message of unspoken) spokenIds.add(message.id)
    }
    if (pendingPromptCount > 0) clearTimeoutRef(noDeliveryTimerRef)
    if (status !== 'idle') {
      clearWorkingTimers()
      return
    }
    const hasIncomplete = hasIncompleteAssistant(messages, state.baselineId)
    const complete = isVoiceTurnComplete({
      status,
      sawBusy: state.sawBusy,
      spoke: hasSpokenMessage(messages, state.baselineId, spokenIds),
      hasPendingPrompts: pendingPromptCount > 0,
      hasIncomplete,
    })
    if (!complete) {
      if (hasIncomplete && finalGraceTimerRef.current === null) {
        finalGraceTimerRef.current = setTimeout(() => {
          finalGraceTimerRef.current = null
          dispatch({ type: 'turn-complete' })
        }, TURN_FINAL_MESSAGE_GRACE_MS)
      }
      if (pendingPromptCount === 0 && noDeliveryTimerRef.current === null) {
        noDeliveryTimerRef.current = setTimeout(() => {
          noDeliveryTimerRef.current = null
          dispatch({ type: 'send-failed', message: TURN_NOT_DELIVERED_MESSAGE })
        }, TURN_NOT_DELIVERED_TIMEOUT_MS)
      }
      return
    }
    clearWorkingTimers()
    dispatch({ type: 'turn-complete' })
  }, [
    state.phase,
    state.baselineId,
    state.sawBusy,
    status,
    messages,
    pendingPromptCount,
    hasPendingApproval,
    clearWorkingTimers,
    speakMessage,
  ])

  useEffect(() => {
    if (state.phase !== 'listening' || status === 'idle') return
    if (stt.isExternalProvider && (stt.isRecording || stt.isProcessing)) return
    if (turnTextValue || interimText) return
    sttRef.current?.abortRecording()
    dispatch({ type: 'turn-started', baselineId: currentTurnBaseline(messages) })
  }, [
    state.phase,
    status,
    interimText,
    turnTextValue,
    messages,
    stt.isExternalProvider,
    stt.isRecording,
    stt.isProcessing,
  ])

  const start = useCallback(() => {
    if (phaseRef.current !== 'off') return
    if (!canStart) {
      setNotice(STT_UNAVAILABLE_NOTICE)
      return
    }
    const latest = latestRef.current
    if (latest.tts.isPlaying) latest.tts.stop()
    fireImpactHaptic()
    invalidateTurn()
    instructionEpochRef.current += 1
    pendingTurnBaselineRef.current = null
    spokenIdsRef.current.clear()
    speakingIdRef.current = null
    activeSessionIDRef.current = latest.sessionID
    setNotice(null)
    dispatch({
      type: 'start',
      busy: latest.status !== 'idle',
      baselineId: currentTurnBaseline(latest.messages),
    })
    instructionPutRef.current = putSessionInstruction(
      latest.sessionID,
      VOICE_MODE_INSTRUCTION_KEY,
      VOICE_MODE_INSTRUCTIONS,
      latest.serverId,
    ).catch(() => setNotice(VOICE_INSTRUCTIONS_NOTICE))
  }, [canStart, invalidateTurn])

  const requestPause = useCallback(
    (reason: VoicePauseReason) => {
      const phase = phaseRef.current
      if (phase === 'off' || phase === 'paused') return
      if (phase === 'working' || phase === 'recording') {
        pendingTurnBaselineRef.current = baselineIdRef.current
      } else if (phase === 'sending') {
        pendingTurnBaselineRef.current = latestMessageBaseline(latestRef.current.messages)
      } else {
        pendingTurnBaselineRef.current = null
      }
      invalidateTurn()
      if (phase === 'listening' || phase === 'recording') sttRef.current?.abortRecording()
      if (phase === 'speaking') {
        const playback = latestRef.current.tts
        if (playback.isPlaying) {
          playback.pause()
          clearSpeakingWatchdog()
          setHeldPlayback(true)
        } else {
          speakTokenRef.current += 1
          speakingIdRef.current = null
          playback.stop()
        }
      }
      dispatch({ type: 'pause', reason })
    },
    [invalidateTurn, clearSpeakingWatchdog, setHeldPlayback],
  )

  const pause = useCallback(() => {
    requestPause('user')
  }, [requestPause])

  const performExit = useCallback(
    (draftText: string) => {
      const latest = latestRef.current
      const current = sttRef.current
      invalidateTurn()
      pendingTurnBaselineRef.current = null
      spokenIdsRef.current.clear()
      speakingIdRef.current = null
      if (current && (current.isRecording || current.isProcessing)) current.abortRecording()
      if (phaseRef.current === 'speaking' || playbackHeldRef.current) {
        speakTokenRef.current += 1
        setHeldPlayback(false)
        latest.tts.stop()
      }
      const capturedSessionID = activeSessionIDRef.current
      const capturedEpoch = instructionEpochRef.current
      activeSessionIDRef.current = null
      dispatch({ type: 'exit' })
      exitInFlightRef.current = false
      setNotice(null)
      if (capturedSessionID && draftText) latest.onEditInTextBox(draftText)
      if (!capturedSessionID) return
      const pendingPut = instructionPutRef.current
      instructionPutRef.current = null
      removeVoiceInstructionAfterInstall(
        capturedSessionID,
        latest.serverId,
        instructionEpochRef,
        capturedEpoch,
        pendingPut,
      )
    },
    [invalidateTurn, setHeldPlayback],
  )

  const readCapturedText = useCallback((): string => {
    const current = sttRef.current
    if (!current) return ''
    return capturedWords(current.transcript) || capturedWords(current.interimTranscript)
  }, [])

  const exit = useCallback(() => {
    if (phaseRef.current === 'off' || exitInFlightRef.current) return
    performExit('')
  }, [performExit])

  const editInTextBox = useCallback(() => {
    const phase = phaseRef.current
    if (phase === 'off' || exitInFlightRef.current) return
    const capturedText = readCapturedText()
    if ((phase !== 'listening' && phase !== 'recording') || !capturedText) {
      performExit('')
      return
    }
    exitInFlightRef.current = true
    invalidateTurn()
    void (async () => {
      const stoppedText = await stopCapture()
      performExit(stoppedText || capturedText)
    })()
  }, [invalidateTurn, performExit, readCapturedText, stopCapture])

  const resumeConversation = useCallback(() => {
    if (phaseRef.current !== 'paused') return
    const latest = latestRef.current
    if (playbackHeldRef.current) {
      setHeldPlayback(false)
      if (latest.tts.isPaused) {
        latest.tts.resume()
        dispatch({ type: 'resume-speech' })
        return
      }
      speakingIdRef.current = null
    }
    const pendingTurnBaseline = pendingTurnBaselineRef.current
    pendingTurnBaselineRef.current = null
    const resumeBaseline = pendingTurnBaseline ?? baselineIdRef.current
    const hasUnspoken =
      resumeBaseline !== null &&
      findNextUnspokenMessage(latest.messages, resumeBaseline, spokenIdsRef.current) !== null
    dispatch({
      type: 'resume',
      busy: latest.status !== 'idle' || pendingTurnBaseline !== null || hasUnspoken,
      baselineId: resumeBaseline ?? currentTurnBaseline(latest.messages),
    })
  }, [setHeldPlayback])

  const tapOrb = useCallback(() => {
    const phase = phaseRef.current
    const latest = latestRef.current
    switch (phase) {
      case 'listening':
        void endTurnRef.current?.()
        return
      case 'recording':
        void endRecordingRef.current?.()
        return
      case 'working':
        dispatch({ type: 'record' })
        return
      case 'speaking':
        if (latest.status === 'idle') {
          for (const message of listUnspokenMessages(
            latest.messages,
            baselineIdRef.current,
            spokenIdsRef.current,
          )) {
            spokenIdsRef.current.add(message.id)
          }
          speakTokenRef.current += 1
          speakingIdRef.current = null
          latest.tts.stop()
          dispatch({ type: 'skip' })
          return
        }
        speakTokenRef.current += 1
        latest.tts.stop()
        if (speakingIdRef.current !== null) {
          spokenIdsRef.current.delete(speakingIdRef.current)
          speakingIdRef.current = null
        }
        dispatch({ type: 'record' })
        return
      case 'paused':
        resumeConversation()
        return
      default:
        return
    }
  }, [resumeConversation])

  const stopAgent = useCallback(() => {
    void latestRef.current.interrupt()
  }, [])

  useEffect(() => {
    const spokenIds = spokenIdsRef.current
    return () => {
      invalidateTurn()
      pendingTurnBaselineRef.current = null
      spokenIds.clear()
      speakingIdRef.current = null
      playbackHeldRef.current = false
      clearWorkingTimers()
      clearSpeakingWatchdog()
      clearListeningTimers()
      const capturedSessionID = activeSessionIDRef.current
      const capturedEpoch = instructionEpochRef.current
      activeSessionIDRef.current = null
      if (!capturedSessionID) return
      dispatch({ type: 'exit' })
      sttRef.current?.abortRecording()
      const { tts: capturedTts, serverId: capturedServerId } = latestRef.current
      speakTokenRef.current += 1
      capturedTts.stop()
      const pendingPut = instructionPutRef.current
      instructionPutRef.current = null
      removeVoiceInstructionAfterInstall(
        capturedSessionID,
        capturedServerId,
        instructionEpochRef,
        capturedEpoch,
        pendingPut,
      )
    }
  }, [
    sessionID,
    clearWorkingTimers,
    clearSpeakingWatchdog,
    clearListeningTimers,
    invalidateTurn,
  ])

  useEffect(() => {
    let cancelled = false
    void listSessionInstructionKeys(sessionID, serverId)
      .then((keys) => {
        if (cancelled) return
        if (phaseRef.current !== 'off') return
        if (!keys.includes(VOICE_MODE_INSTRUCTION_KEY)) return
        return removeSessionInstruction(sessionID, VOICE_MODE_INSTRUCTION_KEY, serverId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionID, serverId])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') requestPause('background')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [requestPause])

  useEffect(() => {
    const wasError = previousSttErrorRef.current
    previousSttErrorRef.current = stt.isError
    if (!stt.isError || wasError) return
    failCapture(stt.error ?? STT_FAILED_MESSAGE)
  }, [stt.isError, stt.error, failCapture])

  const hasHeldReading = state.phase === 'paused' && playbackHeld
  const isCapturing = state.phase === 'listening' || state.phase === 'recording'
  const textInput = {
    phase: state.phase,
    pauseReason: state.pauseReason,
    pendingApproval: hasPendingApproval,
    isEndpointing: stt.isEndpointing,
    isPlaybackPaused: hasHeldReading,
    sessionBusy: status !== 'idle',
    error: state.error,
    failureSource: state.failureSource,
    isStartingCapture: isCapturing && stt.isStarting,
  }
  const label = voiceConversationLabel(textInput)
  const hint = voiceConversationHint(textInput)
  const liveTranscript = isCapturing ? interimText || turnTextValue : ''
  const canEditInTextBox = isCapturing && (interimText !== '' || turnTextValue !== '')
  const canStopAgent = isActive && status !== 'idle'

  return {
    isActive,
    phase: state.phase,
    label,
    hint,
    orbLabel: orbLabelFor(state.phase, canStopAgent, hasHeldReading),
    liveTranscript,
    canEditInTextBox,
    canStopAgent,
    hasHeldReading,
    isEndpointing: stt.isEndpointing,
    notice,
    start,
    exit,
    editInTextBox,
    tapOrb,
    pause,
    resume: resumeConversation,
    stopAgent,
  }
}
