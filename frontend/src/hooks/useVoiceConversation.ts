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

export interface UseVoiceConversationInput {
  sessionID: string
  serverId?: string
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: VoiceSessionStatus
  hasPendingApproval: boolean
  pauseMs: number
  sendTurn: (text: string, options: { busy: boolean }) => Promise<void>
  interrupt: () => Promise<void>
  onEditInTextBox: (text: string) => void
}

export interface VoiceConversationController {
  isActive: boolean
  phase: VoicePhase
  label: string
  hint: string
  orbLabel: string
  liveTranscript: string
  canEditInTextBox: boolean
  canStopAgent: boolean
  hasHeldReading: boolean
  isEndpointing: boolean
  notice: string | null
  start: () => void
  exit: () => void
  editInTextBox: () => void
  tapOrb: () => void
  pause: () => void
  resume: () => void
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

const ORB_LABELS = {
  off: 'Voice conversation',
  listening: 'Send now',
  sending: 'Sending',
  working: 'Add a message',
  speaking: 'Skip reply',
  recording: 'Send to queue',
  paused: 'Resume voice conversation',
}

function clearTimeoutRef(ref: TimeoutRef): void {
  if (ref.current === null) return
  clearTimeout(ref.current)
  ref.current = null
}

function latestMessageBaseline(messages: readonly SessionMessageInfo[]): string | null {
  return messages[messages.length - 1]?.id ?? null
}

function currentTurnBaseline(messages: readonly SessionMessageInfo[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'user') return message.id
  }
  return null
}

function capturedWords(text: string): string {
  const trimmed = text.trim()
  return STT_PLACEHOLDERS.includes(trimmed) ? '' : trimmed
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : 'The turn could not be sent'
}

function fireImpactHaptic(): void {
  if (!('navigator' in globalThis)) return
  navigator.vibrate?.(10)
}

function removeVoiceInstructionAfterInstall(
  removeInstruction: VoiceConversationCollaborators['removeSessionInstruction'],
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
      return removeInstruction(sessionID, VOICE_MODE_INSTRUCTION_KEY, serverId)
    })
    .catch(() => {})
}

function orbLabelFor(
  phase: VoicePhase,
  canStopAgent: boolean,
  hasHeldReading: boolean,
): string {
  if (phase === 'speaking') return canStopAgent ? 'Add a message' : ORB_LABELS.speaking
  if (phase === 'paused') return hasHeldReading ? 'Continue reading' : ORB_LABELS.paused
  return ORB_LABELS[phase]
}

export interface VoiceConversationCollaborators {
  useStt: () => ReturnType<typeof useSTT>
  useTts: () => ReturnType<typeof useTTS>
  putSessionInstruction: typeof putSessionInstruction
  removeSessionInstruction: typeof removeSessionInstruction
  listSessionInstructionKeys: typeof listSessionInstructionKeys
}

const DEFAULT_COLLABORATORS = {
  useStt: useSTT,
  useTts: useTTS,
  putSessionInstruction,
  removeSessionInstruction,
  listSessionInstructionKeys,
} satisfies VoiceConversationCollaborators

export function useVoiceConversation(
  input: UseVoiceConversationInput,
  collaborators: Partial<VoiceConversationCollaborators> = {},
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
  const sttHook = collaborators.useStt ?? DEFAULT_COLLABORATORS.useStt
  const ttsHook = collaborators.useTts ?? DEFAULT_COLLABORATORS.useTts
  const putInstruction = collaborators.putSessionInstruction ?? DEFAULT_COLLABORATORS.putSessionInstruction
  const removeInstruction = collaborators.removeSessionInstruction ?? DEFAULT_COLLABORATORS.removeSessionInstruction
  const listInstructionKeys = collaborators.listSessionInstructionKeys ?? DEFAULT_COLLABORATORS.listSessionInstructionKeys
  const tts = ttsHook()
  const stt = sttHook()

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
        onEnd: (reason, error) => {
          if (speakTokenRef.current !== token) return
          if (reason === 'error') {
            speakTokenRef.current += 1
            speakingIdRef.current = null
            dispatch({
              type: 'error',
              message: error ? `${REPLY_READ_FAILED_MESSAGE}: ${error}` : REPLY_READ_FAILED_MESSAGE,
              source: 'playback',
            })
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
    latest.tts.unlock()
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
    instructionPutRef.current = putInstruction(
      latest.sessionID,
      VOICE_MODE_INSTRUCTION_KEY,
      VOICE_MODE_INSTRUCTIONS,
      latest.serverId,
    ).catch(() => setNotice(VOICE_INSTRUCTIONS_NOTICE))
  }, [canStart, invalidateTurn, putInstruction])

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
        removeInstruction,
        capturedSessionID,
        latest.serverId,
        instructionEpochRef,
        capturedEpoch,
        pendingPut,
      )
    },
    [invalidateTurn, removeInstruction, setHeldPlayback],
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
    latest.tts.unlock()
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
        removeInstruction,
        capturedSessionID,
        capturedServerId,
        instructionEpochRef,
        capturedEpoch,
        pendingPut,
      )
    }
  }, [
    removeInstruction,
    sessionID,
    clearWorkingTimers,
    clearSpeakingWatchdog,
    clearListeningTimers,
    invalidateTurn,
  ])

  useEffect(() => {
    let cancelled = false
    void listInstructionKeys(sessionID, serverId)
      .then((keys) => {
        if (cancelled) return
        if (phaseRef.current !== 'off') return
        if (!keys.includes(VOICE_MODE_INSTRUCTION_KEY)) return
        return removeInstruction(sessionID, VOICE_MODE_INSTRUCTION_KEY, serverId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [listInstructionKeys, removeInstruction, sessionID, serverId])

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
