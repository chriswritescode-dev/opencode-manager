import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { getWebSpeechRecognizer, isWebRecognitionSupported, appendTranscriptSegment, type SpeechRecognitionOptions, type SpeechRecognitionResult, type RecognitionState, type SttEndpointingOptions, type SttEndOfSpeechReason } from '@/lib/webSpeechRecognizer'
import { AudioRecorder } from '@/lib/audioRecorder'
import { sttApi } from '@/api/stt'
import { FetchError } from '@/api/fetchWrapper'
import { DEFAULT_STT_CONFIG, type STTConfig } from '@/api/types/settings'

const STT_START_TIMEOUT_MS = 10_000

/** Whether the user's speech-to-text configuration can capture in this browser. */
export interface SttAvailability {
  /** Whether speech-to-text is enabled in the user's voice settings. */
  isEnabled: boolean
  /** Whether the configured speech-to-text provider can capture in this browser. */
  isSupported: boolean
}

function resolveSttAvailability(config: STTConfig): SttAvailability {
  const isExternalProvider = config.provider === 'external'
  return {
    isEnabled: config.enabled,
    isSupported: isExternalProvider ? AudioRecorder.isSupported() : isWebRecognitionSupported(),
  }
}

/**
 * Reads whether speech-to-text can capture, without creating a recorder.
 *
 * @returns The enabled flag from the user's voice settings and the browser support of its provider.
 */
export function useSttAvailability(): SttAvailability {
  const { preferences } = useSettings()
  return resolveSttAvailability(preferences?.stt ?? DEFAULT_STT_CONFIG)
}

export interface StartRecordingOptions {
  /** Enables automatic end-of-speech for the browser provider. Ignored by the external provider. */
  endpointing?: SttEndpointingOptions
  /**
   * Called when the browser provider ends the capture by itself. Receives the
   * final transcript so a caller can send it without waiting for a render.
   */
  onEndOfSpeech?: (reason: SttEndOfSpeechReason, finalText: string) => void
}

export function useSTT(userId = 'default') {
  const { preferences } = useSettings(userId)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [state, setState] = useState<RecognitionState>('idle')
  const [isEndpointing, setIsEndpointing] = useState(false)

  const recognizer = useRef(getWebSpeechRecognizer())
  const audioRecorder = useRef<AudioRecorder | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const userIdRef = useRef(userId)
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProcessedBlobRef = useRef<Blob | null>(null)
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startOpIdRef = useRef(0)
  const recorderConfiguredRef = useRef(false)
  const interimRafRef = useRef<number | null>(null)
  const pendingInterimRef = useRef<string>('')
  
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const config = preferences?.stt ?? DEFAULT_STT_CONFIG
  const isExternalProvider = config.provider === 'external'
  const { isEnabled, isSupported } = resolveSttAvailability(config)

  const flashError = useCallback((message: string) => {
    setIsError(true)
    setError(message)
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
    errorTimeoutRef.current = setTimeout(() => {
      setIsError(false)
      setError(null)
      errorTimeoutRef.current = null
    }, 3000)
  }, [])

  const resetToIdle = useCallback((clearInterim = false) => {
    setIsRecording(false)
    setIsProcessing(false)
    setIsEndpointing(false)
    setState('idle')
    if (clearInterim) setInterimTranscript('')
  }, [])

  useEffect(() => {
    if (!isEnabled || isExternalProvider) {
      return
    }

    if (!isWebRecognitionSupported()) {
      return
    }

    const rec = recognizer.current

    rec.onResult((result: SpeechRecognitionResult) => {
      setIsProcessing(false)
      setTranscript((prev) => appendTranscriptSegment(prev, result.transcript))
    })

    rec.onInterimResult((interim: string) => {
      pendingInterimRef.current = interim.trim()
      if (interimRafRef.current != null) return
      interimRafRef.current = requestAnimationFrame(() => {
        interimRafRef.current = null
        setInterimTranscript(pendingInterimRef.current)
      })
    })

    rec.onError((errorMessage: string) => {
      setIsProcessing(false)
      setIsRecording(false)
      flashError(errorMessage)
    })

    rec.onEnd(() => {
      resetToIdle()
    })

    rec.onStart(() => {
      setIsRecording(true)
      setIsProcessing(false)
      setState('listening')
      setInterimTranscript('')
    })

    return () => {
      rec.clearCallbacks()
      if (interimRafRef.current != null) {
        cancelAnimationFrame(interimRafRef.current)
        interimRafRef.current = null
      }
    }
  }, [isEnabled, isExternalProvider, flashError, resetToIdle])

  const setupAudioRecorder = useCallback((recorder: AudioRecorder) => {
    recorder.setOnStateChange((recState) => {
      if (recState === 'recording') {
        setIsRecording(true)
        setIsProcessing(false)
        setState('listening')
        setInterimTranscript('Recording...')
      } else if (recState === 'stopped') {
        setIsRecording(false)
      } else if (recState === 'error') {
        resetToIdle()
      } else if (recState === 'idle') {
        setState('idle')
      }
    })

    recorder.setOnError((errorMessage) => {
      setIsProcessing(false)
      setIsRecording(false)
      flashError(errorMessage)
    })

    recorder.setOnNoSpeech(() => {
      resetToIdle(true)
    })

    recorder.setOnDataAvailable(async (blob) => {
      if (lastProcessedBlobRef.current === blob) {
        return
      }
      lastProcessedBlobRef.current = blob
      
      setInterimTranscript('Processing...')
      setIsProcessing(true)
      
      try {
        abortControllerRef.current = new AbortController()
        const result = await sttApi.transcribe(
          blob,
          userIdRef.current || 'default',
          abortControllerRef.current.signal
        )
        
        setTranscript((prev) => appendTranscriptSegment(prev, result.text))
        setInterimTranscript('')
      } catch (err) {
        if (err instanceof Error && (
          err.name === 'CanceledError' ||
          (err instanceof FetchError && (err.code === 'CANCELED' || err.statusCode === 499))
        )) {
          return
        }
        
        flashError(err instanceof Error ? err.message : 'Transcription failed')
      } finally {
        setIsProcessing(false)
        setState('idle')
        abortControllerRef.current = null
      }
    })
  }, [flashError, resetToIdle])

  const ensureAudioRecorder = useCallback((): AudioRecorder => {
    if (!audioRecorder.current) {
      audioRecorder.current = new AudioRecorder()
    }
    if (!recorderConfiguredRef.current) {
      setupAudioRecorder(audioRecorder.current)
      recorderConfiguredRef.current = true
    }
    return audioRecorder.current
  }, [setupAudioRecorder])

  const disposeAudioRecorder = useCallback(() => {
    if (audioRecorder.current) {
      audioRecorder.current.dispose()
      audioRecorder.current = null
    }
    recorderConfiguredRef.current = false
  }, [])

  useEffect(() => {
    return () => {
      disposeAudioRecorder()
    }
  }, [isEnabled, isExternalProvider, disposeAudioRecorder])

  const clearStartupTimeout = useCallback(() => {
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current)
      startupTimeoutRef.current = null
    }
  }, [])

  const abortAndResetOnTimeout = useCallback(() => {
    if (isExternalProvider) {
      disposeAudioRecorder()
    } else {
      recognizer.current.abort()
    }
    resetToIdle()
    setIsError(true)
    setError('Microphone start timed out')
  }, [isExternalProvider, disposeAudioRecorder, resetToIdle])

  const runStartupWithTimeout = useCallback(
    async (startup: () => Promise<void>, startOpId: number): Promise<boolean> => {
      try {
        const startupPromise = startup()
        const timeoutPromise = new Promise<never>((_, reject) => {
          startupTimeoutRef.current = setTimeout(() => {
            if (startOpIdRef.current !== startOpId) return
            reject(new Error('Microphone start timed out'))
          }, STT_START_TIMEOUT_MS)
        })

        await Promise.race([startupPromise, timeoutPromise])
        clearStartupTimeout()

        return startOpIdRef.current === startOpId
      } catch (err) {
        clearStartupTimeout()
        if (startOpIdRef.current !== startOpId) return false
        setIsProcessing(false)
        if (err instanceof Error && err.message === 'Microphone start timed out') {
          abortAndResetOnTimeout()
          return false
        }
        setIsError(true)
        setError(err instanceof Error ? err.message : 'Failed to start recording')
        return false
      }
    },
    [clearStartupTimeout, abortAndResetOnTimeout],
  )

  const startRecording = useCallback(async (options?: StartRecordingOptions): Promise<boolean> => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser')
      setIsError(true)
      return false
    }

    if (!isEnabled) {
      setError('Speech recognition is not enabled')
      setIsError(true)
      return false
    }

    const endpointing = isExternalProvider ? undefined : options?.endpointing
    const onEndOfSpeech = endpointing ? options?.onEndOfSpeech : undefined

    setTranscript('')
    setInterimTranscript('')
    setIsError(false)
    setError(null)
    setIsEndpointing(Boolean(endpointing))
    lastProcessedBlobRef.current = null

    const startOpId = ++startOpIdRef.current
    clearStartupTimeout()

    if (isExternalProvider) {
      const recorder = ensureAudioRecorder()

      setIsProcessing(true)
      const started = await runStartupWithTimeout(() => recorder.start(), startOpId)
      if (started) {
        setIsProcessing(false)
      }
      return started
    } else {
      const recognitionOptions: SpeechRecognitionOptions = {
        language: config.language,
        interimResults: true,
        maxAlternatives: 1,
      }

      if (endpointing) {
        recognitionOptions.inactivityTimeoutMs = endpointing.pauseMs
        recognitionOptions.endpointing = endpointing
      }

      if (onEndOfSpeech) {
        recognitionOptions.onEndOfSpeech = (reason, finalText) => {
          if (finalText) setTranscript(finalText)
          onEndOfSpeech(reason, finalText)
        }
      }

      setIsProcessing(true)
      const started = await runStartupWithTimeout(() => recognizer.current.start(recognitionOptions), startOpId)
      if (!started && startOpIdRef.current === startOpId) {
        setIsEndpointing(false)
      }
      return started
    }
  }, [isSupported, isEnabled, isExternalProvider, config.language, clearStartupTimeout, ensureAudioRecorder, runStartupWithTimeout])

  const stopRecording = useCallback(() => {
    if (isExternalProvider && audioRecorder.current) {
      if (audioRecorder.current.getState() !== 'recording') {
        return
      }
      setIsProcessing(true)
      audioRecorder.current.stop()
    } else {
      setIsProcessing(true)
      recognizer.current.stop()
    }
  }, [isExternalProvider])

  const abortRecording = useCallback(() => {
    if (isExternalProvider && audioRecorder.current) {
      audioRecorder.current.abort()
    } else {
      recognizer.current.abort()
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setTranscript('')
    resetToIdle(true)
  }, [isExternalProvider, resetToIdle])

  const reset = useCallback(() => {
    setTranscript('')
    setIsError(false)
    setError(null)
    resetToIdle(true)
  }, [resetToIdle])

  const clear = useCallback(() => {
    setTranscript('')
    setInterimTranscript('')
  }, [])

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      clearStartupTimeout()
    }
  }, [clearStartupTimeout])

  return {
    isRecording,
    isProcessing,
    isError,
    error,
    transcript,
    interimTranscript,
    state,
    isEndpointing,
    isSupported,
    isEnabled,
    isExternalProvider,
    startRecording,
    stopRecording,
    abortRecording,
    reset,
    clear,
  }
}
