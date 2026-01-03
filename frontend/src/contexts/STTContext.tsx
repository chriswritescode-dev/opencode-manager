import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { sttApi } from '@/api/stt'
import { STTContext, type STTState } from './stt-context'

export { STTContext, type STTContextValue, type STTState, type STTConfig } from './stt-context'

interface STTProviderProps {
  children: ReactNode
}

export function STTProvider({ children }: STTProviderProps) {
  const { preferences } = useSettings()
  const [state, setState] = useState<STTState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const sttConfig = preferences?.stt
  const isEnabled = sttConfig?.enabled ?? false

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    audioChunksRef.current = []
    setRecordingDuration(0)
  }, [])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  const startRecording = useCallback(async () => {
    if (!isEnabled) {
      setError('STT is not enabled')
      setState('error')
      return
    }

    try {
      cleanup()
      setError(null)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onerror = () => {
        setError('Recording failed')
        setState('error')
        cleanup()
      }

      mediaRecorder.start(100)
      startTimeRef.current = Date.now()
      setState('recording')

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 100)

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone'
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Microphone permission denied')
      } else {
        setError(message)
      }
      setState('error')
    }
  }, [isEnabled, cleanup])

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current || state !== 'recording') {
      return null
    }

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!

      mediaRecorder.onstop = async () => {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current)
          durationIntervalRef.current = null
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }

        if (audioChunksRef.current.length === 0) {
          setError('No audio recorded')
          setState('error')
          resolve(null)
          return
        }

        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        })
        audioChunksRef.current = []

        if (audioBlob.size < 1000) {
          setError('Recording too short')
          setState('idle')
          resolve(null)
          return
        }

        setState('transcribing')

        try {
          const result = await sttApi.transcribe(audioBlob, 'default', {
            model: sttConfig?.model,
            language: sttConfig?.language
          })

          setState('idle')
          setRecordingDuration(0)
          resolve(result.text)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Transcription failed'
          setError(message)
          setState('error')
          resolve(null)
        }
      }

      mediaRecorder.stop()
    })
  }, [state, sttConfig?.model, sttConfig?.language])

  const cancelRecording = useCallback(() => {
    cleanup()
    setState('idle')
    setError(null)
  }, [cleanup])

  const value = {
    startRecording,
    stopRecording,
    cancelRecording,
    state,
    error,
    isEnabled,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
    isIdle: state === 'idle',
    recordingDuration
  }

  return (
    <STTContext.Provider value={value}>
      {children}
    </STTContext.Provider>
  )
}
