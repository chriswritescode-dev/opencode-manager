import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { getWebSpeechRecognizer, isWebRecognitionSupported, type SpeechRecognitionOptions, type SpeechRecognitionResult, type RecognitionState } from '@/lib/webSpeechRecognizer'
import { AudioRecorder } from '@/lib/audioRecorder'
import { sttApi } from '@/api/stt'
import { DEFAULT_STT_CONFIG } from '@/api/types/settings'

const STT_START_TIMEOUT_MS = 10_000

export function useSTT(userId = 'default') {
  const { preferences } = useSettings(userId)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [state, setState] = useState<RecognitionState>('idle')

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

  const isEnabled = preferences?.stt?.enabled ?? false
  const config = preferences?.stt ?? DEFAULT_STT_CONFIG
  const isExternalProvider = config.provider === 'external'

  const isSupported = isExternalProvider 
    ? true
    : isWebRecognitionSupported()

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
      setTranscript((prev) => {
        const prevTrimmed = prev.trim()
        const next = result.transcript.trim()
        return prevTrimmed ? `${prevTrimmed} ${next}` : next
      })
      setIsRecording(false)
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
      setIsError(true)
      setError(errorMessage)

      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = setTimeout(() => {
        setIsError(false)
        setError(null)
        errorTimeoutRef.current = null
      }, 3000)
    })

    rec.onEnd(() => {
      setIsRecording(false)
      setIsProcessing(false)
      setState('idle')
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
  }, [isEnabled, isExternalProvider])

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
        setIsRecording(false)
        setIsProcessing(false)
        setState('idle')
      } else if (recState === 'idle') {
        setState('idle')
      }
    })

    recorder.setOnError((errorMessage) => {
      setIsProcessing(false)
      setIsRecording(false)
      setIsError(true)
      setError(errorMessage)

      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = setTimeout(() => {
        setIsError(false)
        setError(null)
        errorTimeoutRef.current = null
      }, 3000)
    })

    recorder.setOnNoSpeech(() => {
      setIsProcessing(false)
      setIsRecording(false)
      setInterimTranscript('')
      setState('idle')
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
        
        setTranscript((prev) => {
          const prevTrimmed = prev.trim()
          const newText = result.text.trim()
          return prevTrimmed ? `${prevTrimmed} ${newText}` : newText
        })
        setInterimTranscript('')
      } catch (err) {
        if (err instanceof Error && err.name === 'CanceledError') {
          return
        }
        
        setIsError(true)
        const errorMessage = err instanceof Error ? err.message : 'Transcription failed'
        setError(errorMessage)
        
        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
        errorTimeoutRef.current = setTimeout(() => {
          setIsError(false)
          setError(null)
          errorTimeoutRef.current = null
        }, 3000)
      } finally {
        setIsProcessing(false)
        setState('idle')
        abortControllerRef.current = null
      }
    })
  }, [])

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
    if (!isEnabled || !isExternalProvider) {
      return
    }

    void ensureAudioRecorder().prepare().catch(() => undefined)

    return () => {
      disposeAudioRecorder()
    }
  }, [isEnabled, isExternalProvider, ensureAudioRecorder, disposeAudioRecorder])

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
    setIsRecording(false)
    setIsProcessing(false)
    setState('idle')
    setIsError(true)
    setError('Microphone start timed out')
  }, [isExternalProvider, disposeAudioRecorder])

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

  const startRecording = useCallback(async (): Promise<boolean> => {
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

    setTranscript('')
    setInterimTranscript('')
    setIsError(false)
    setError(null)
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
      const options: SpeechRecognitionOptions = {
        language: config.language,
        interimResults: true,
        maxAlternatives: 1,
      }

      setIsProcessing(true)
      return runStartupWithTimeout(() => recognizer.current.start(options), startOpId)
    }
  }, [isSupported, isEnabled, isExternalProvider, config.language, clearStartupTimeout, ensureAudioRecorder, runStartupWithTimeout])

  const stopRecording = useCallback(() => {
    if (isExternalProvider && audioRecorder.current) {
      audioRecorder.current.stop()
      setIsProcessing(true)
    } else {
      recognizer.current.stop()
      setIsProcessing(true)
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
    setInterimTranscript('')
    setIsRecording(false)
    setIsProcessing(false)
    setState('idle')
  }, [isExternalProvider])

  const reset = useCallback(() => {
    setTranscript('')
    setInterimTranscript('')
    setIsError(false)
    setError(null)
    setIsRecording(false)
    setIsProcessing(false)
    setState('idle')
  }, [])

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
