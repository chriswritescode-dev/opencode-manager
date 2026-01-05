import { useState, useRef, useCallback, useEffect } from 'react'
import { sttApi } from '@/api/stt'

interface UseStreamingVADOptions {
  chunkIntervalMs?: number
  silenceTimeoutMs?: number
  onTranscriptUpdate?: (transcript: string, isFinal: boolean) => void
  onSpeechEnd?: (fullTranscript: string) => void
  sttConfig?: {
    model?: string
    language?: string
  }
}

interface UseStreamingVADReturn {
  isListening: boolean
  isProcessing: boolean
  error: string | null
  currentTranscript: string
  start: () => Promise<void>
  stop: () => void
}

export function useStreamingVAD(options: UseStreamingVADOptions = {}): UseStreamingVADReturn {
  const {
    chunkIntervalMs = 2500,
    silenceTimeoutMs = 1500,
    onTranscriptUpdate,
    onSpeechEnd,
    sttConfig
  } = options

  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTranscript, setCurrentTranscript] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullTranscriptRef = useRef('')
  const lastTranscriptTimeRef = useRef(0)
  const isActiveRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
      chunkIntervalRef.current = null
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
  }, [])

  const processChunk = useCallback(async () => {
    if (chunksRef.current.length === 0 || !isActiveRef.current) return

    const chunks = chunksRef.current
    chunksRef.current = []

    const audioBlob = new Blob(chunks, { type: 'audio/webm;codecs=opus' })
    
    if (audioBlob.size < 1000) return

    setIsProcessing(true)

    try {
      const base64Audio = await blobToBase64(audioBlob)
      
      const result = await sttApi.transcribeBase64(base64Audio, 'webm', {
        model: sttConfig?.model,
        language: sttConfig?.language
      })

      if (!isActiveRef.current) return

      const newText = result.text?.trim()
      
      if (newText && newText.length > 0) {
        lastTranscriptTimeRef.current = Date.now()
        
        if (fullTranscriptRef.current) {
          fullTranscriptRef.current += ' ' + newText
        } else {
          fullTranscriptRef.current = newText
        }
        
        setCurrentTranscript(fullTranscriptRef.current)
        onTranscriptUpdate?.(fullTranscriptRef.current, false)

        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current)
        }
        silenceTimeoutRef.current = setTimeout(() => {
          if (isActiveRef.current && fullTranscriptRef.current) {
            onTranscriptUpdate?.(fullTranscriptRef.current, true)
            onSpeechEnd?.(fullTranscriptRef.current)
            fullTranscriptRef.current = ''
            setCurrentTranscript('')
          }
        }, silenceTimeoutMs)
      }
    } catch (err) {
      console.error('[StreamingVAD] Transcription error:', err)
    } finally {
      setIsProcessing(false)
    }
  }, [sttConfig?.model, sttConfig?.language, silenceTimeoutMs, onTranscriptUpdate, onSpeechEnd])

  const start = useCallback(async () => {
    if (isListening) return

    setError(null)
    fullTranscriptRef.current = ''
    setCurrentTranscript('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start(100)
      isActiveRef.current = true
      setIsListening(true)

      chunkIntervalRef.current = setInterval(() => {
        if (isActiveRef.current) {
          processChunk()
        }
      }, chunkIntervalMs)

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone'
      setError(message)
      console.error('[StreamingVAD] Start error:', err)
    }
  }, [isListening, chunkIntervalMs, processChunk])

  const stop = useCallback(() => {
    isActiveRef.current = false
    clearTimers()

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    chunksRef.current = []
    fullTranscriptRef.current = ''
    setCurrentTranscript('')
    setIsListening(false)
    setIsProcessing(false)
  }, [clearTimers])

  useEffect(() => {
    return () => {
      isActiveRef.current = false
      clearTimers()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [clearTimers])

  return {
    isListening,
    isProcessing,
    error,
    currentTranscript,
    start,
    stop
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
