import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { getWebSpeechRecognizer, isWebRecognitionSupported, type SpeechRecognitionOptions, type SpeechRecognitionResult, type RecognitionState } from '@/lib/webSpeechRecognizer'
import { AudioRecorder } from '@/lib/audioRecorder'
import { sttApi } from '@/api/stt'
import { DEFAULT_STT_CONFIG } from '@/api/types/settings'

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
  const hasShownPermissionError = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const userIdRef = useRef(userId)
  
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
      setTranscript((prev) => prev + ' ' + result.transcript)
      setIsRecording(false)
    })

    rec.onInterimResult((interim: string) => {
      setInterimTranscript(interim.trim())
    })

    rec.onError((errorMessage: string) => {
      setIsProcessing(false)
      setIsRecording(false)
      setIsError(true)
      setError(errorMessage)

      if (!hasShownPermissionError.current && errorMessage.includes('denied')) {
        hasShownPermissionError.current = true
      }

      setTimeout(() => {
        setIsError(false)
        setError(null)
      }, 3000)
    })

    rec.onEnd(() => {
      setIsRecording(false)
      setIsProcessing(false)
      setState('idle')
    })

    rec.onStart(() => {
      setIsRecording(true)
      setState('listening')
      setInterimTranscript('')
    })

    return () => {
      rec.clearCallbacks()
    }
  }, [isEnabled, isExternalProvider])

  const setupAudioRecorder = useCallback((recorder: AudioRecorder) => {
    recorder.setOnStateChange((recState) => {
      if (recState === 'recording') {
        setIsRecording(true)
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

      setTimeout(() => {
        setIsError(false)
        setError(null)
      }, 3000)
    })

    recorder.setOnDataAvailable(async (blob) => {
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
        
        setTimeout(() => {
          setIsError(false)
          setError(null)
        }, 3000)
      } finally {
        setIsProcessing(false)
        setState('idle')
        abortControllerRef.current = null
      }
    })
  }, [])

  useEffect(() => {
    if (!isEnabled || !isExternalProvider) {
      return
    }

    if (!audioRecorder.current) {
      audioRecorder.current = new AudioRecorder()
    }

    setupAudioRecorder(audioRecorder.current)

    return () => {
      if (audioRecorder.current) {
        audioRecorder.current.abort()
      }
    }
  }, [isEnabled, isExternalProvider, setupAudioRecorder])

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser')
      setIsError(true)
      return
    }

    if (!isEnabled) {
      setError('Speech recognition is not enabled')
      setIsError(true)
      return
    }

    setTranscript('')
    setInterimTranscript('')
    setIsError(false)
    setError(null)
    hasShownPermissionError.current = false

    if (isExternalProvider) {
      if (!audioRecorder.current) {
        audioRecorder.current = new AudioRecorder()
        setupAudioRecorder(audioRecorder.current)
      }
      
      try {
        setIsProcessing(true)
        await audioRecorder.current.start()
        setIsProcessing(false)
      } catch (err) {
        setIsProcessing(false)
        setIsError(true)
        setError(err instanceof Error ? err.message : 'Failed to start recording')
      }
    } else {
      const options: SpeechRecognitionOptions = {
        language: config.language,
        continuous: config.continuous,
        interimResults: true,
        maxAlternatives: 1,
      }

      try {
        setIsProcessing(true)
        await recognizer.current.start(options)
      } catch (err) {
        setIsProcessing(false)
        setIsError(true)
        setError(err instanceof Error ? err.message : 'Failed to start recording')
      }
    }
  }, [isSupported, isEnabled, isExternalProvider, config.language, config.continuous, setupAudioRecorder])

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
