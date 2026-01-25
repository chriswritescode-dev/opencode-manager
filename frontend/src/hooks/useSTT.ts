import { useState, useEffect, useRef } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { getWebSpeechRecognizer, isWebRecognitionSupported, type SpeechRecognitionOptions, type SpeechRecognitionResult, type RecognitionState } from '@/lib/webSpeechRecognizer'
import { DEFAULT_STT_CONFIG } from '@/api/types/settings'

export function useSTT() {
  const { preferences } = useSettings()
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [state, setState] = useState<RecognitionState>('idle')

  const recognizer = useRef(getWebSpeechRecognizer())
  const hasShownPermissionError = useRef(false)

  const isEnabled = preferences?.stt?.enabled ?? false
  const config = preferences?.stt ?? DEFAULT_STT_CONFIG

  useEffect(() => {
    if (!isEnabled || !isWebRecognitionSupported()) {
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
  }, [isEnabled])

  const startRecording = async () => {
    if (!isWebRecognitionSupported()) {
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

  const stopRecording = () => {
    recognizer.current.stop()
    setIsProcessing(true)
  }

  const abortRecording = () => {
    recognizer.current.abort()
    setTranscript('')
    setInterimTranscript('')
    setIsRecording(false)
    setIsProcessing(false)
    setState('idle')
  }

  const reset = () => {
    setTranscript('')
    setInterimTranscript('')
    setIsError(false)
    setError(null)
    setIsRecording(false)
    setIsProcessing(false)
    setState('idle')
  }

  const clear = () => {
    setTranscript('')
    setInterimTranscript('')
  }

  return {
    isRecording,
    isProcessing,
    isError,
    error,
    transcript,
    interimTranscript,
    state,
    isSupported: isWebRecognitionSupported(),
    isEnabled,
    startRecording,
    stopRecording,
    abortRecording,
    reset,
    clear,
  }
}
