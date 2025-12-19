import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { API_BASE_URL } from '@/config'
import { TTSContext, type TTSState } from './tts-context'
import { sanitizeForTTS } from '@/lib/utils'

export { TTSContext, type TTSContextValue, type TTSState } from './tts-context'

const SENTENCE_REGEX = /(?<=[.!?])\s+/
const SENTENCES_PER_CHUNK = 2

function splitIntoChunks(text: string): string[] {
  const sentences = text.split(SENTENCE_REGEX).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return [text]

  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_CHUNK) {
    const chunk = sentences.slice(i, i + SENTENCES_PER_CHUNK).join(' ')
    if (chunk.trim()) chunks.push(chunk.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

interface TTSProviderProps {
  children: ReactNode
}

export function TTSProvider({ children }: TTSProviderProps) {
  const { preferences } = useSettings()
  const [state, setState] = useState<TTSState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentText, setCurrentText] = useState<string | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stoppedRef = useRef(false)
  const chunksRef = useRef<string[]>([])
  const chunkIndexRef = useRef(0)
  const prefetchedBlobsRef = useRef<Map<number, Blob>>(new Map())
  const fetchingIndexRef = useRef<number>(-1)

  const ttsConfig = preferences?.tts
  const isEnabled = !!(ttsConfig?.enabled && ttsConfig?.apiKey)

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    prefetchedBlobsRef.current.forEach((_, key) => {
      prefetchedBlobsRef.current.delete(key)
    })
    prefetchedBlobsRef.current.clear()
    chunksRef.current = []
    chunkIndexRef.current = 0
    fetchingIndexRef.current = -1
  }, [])

  const stop = useCallback(() => {
    stoppedRef.current = true
    cleanup()
    setState('idle')
    setCurrentText(null)
    setError(null)
  }, [cleanup])

  useEffect(() => {
    return () => {
      stoppedRef.current = true
      cleanup()
    }
  }, [cleanup])

  const synthesize = useCallback(async (text: string, signal?: AbortSignal): Promise<Blob | null> => {
    if (stoppedRef.current) return null

    try {
      const response = await fetch(`${API_BASE_URL}/api/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      })

      if (stoppedRef.current) return null

      if (!response.ok) {
        let errorMessage = 'TTS request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorData.details || errorMessage
        } catch {
          if (response.status === 401) errorMessage = 'Invalid API key'
          else if (response.status === 429) errorMessage = 'Rate limit exceeded'
          else if (response.status >= 500) errorMessage = 'Service unavailable'
        }
        throw new Error(errorMessage)
      }

      const contentType = response.headers.get('content-type')
      if (!contentType?.includes('audio')) {
        throw new Error('Invalid response from TTS service')
      }

      const blob = await response.blob()
      if (blob.size === 0) {
        throw new Error('Empty audio response')
      }

      return blob
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null
      }
      throw err
    }
  }, [])

  const fetchNextChunk = useCallback(async (index: number) => {
    if (stoppedRef.current) return
    if (index >= chunksRef.current.length) return
    if (prefetchedBlobsRef.current.has(index)) {
      fetchNextChunk(index + 1)
      return
    }
    
    fetchingIndexRef.current = index
    
    try {
      const blob = await synthesize(chunksRef.current[index], abortControllerRef.current?.signal)
      if (blob && !stoppedRef.current) {
        prefetchedBlobsRef.current.set(index, blob)
        fetchNextChunk(index + 1)
      }
    } catch {
      if (stoppedRef.current) return
    }
    
    fetchingIndexRef.current = -1
  }, [synthesize])

  const playChunk = useCallback(async (index: number) => {
    if (stoppedRef.current || index >= chunksRef.current.length) {
      if (!stoppedRef.current) {
        setState('idle')
        setCurrentText(null)
      }
      return
    }

    chunkIndexRef.current = index

    try {
      let blob: Blob | undefined = prefetchedBlobsRef.current.get(index)
      
      if (!blob) {
        setState('loading')
        const fetched = await synthesize(chunksRef.current[index], abortControllerRef.current?.signal)
        if (fetched && !stoppedRef.current) {
          blob = fetched
        }
        fetchNextChunk(index + 1)
      }
      
      if (!blob || stoppedRef.current) return

      prefetchedBlobsRef.current.delete(index)
      
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        if (!stoppedRef.current) {
          playChunk(index + 1)
        }
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        if (!stoppedRef.current) {
          setError('Audio playback failed')
          setState('error')
        }
      }

      setState('playing')
      await audio.play()
    } catch (err) {
      if (stoppedRef.current) return
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
    }
  }, [synthesize, fetchNextChunk])

  const speak = useCallback(async (text: string): Promise<boolean> => {
    if (!ttsConfig?.enabled) {
      setError('TTS is not enabled')
      setState('error')
      return false
    }

    if (!ttsConfig?.apiKey) {
      setError('API key not configured')
      setState('error')
      return false
    }

    if (!text?.trim()) {
      setError('No text provided')
      setState('error')
      return false
    }

    if (!ttsConfig.voice || !ttsConfig.model) {
      setError('Voice or model not configured')
      setState('error')
      return false
    }

    // Sanitize markdown for clean TTS playback
    const sanitizedText = sanitizeForTTS(text)
    
    if (!sanitizedText?.trim()) {
      setError('No readable content after sanitization')
      setState('error')
      return false
    }

    stop()
    stoppedRef.current = false
    setError(null)

    // Store the sanitized text for playback
    setCurrentText(sanitizedText)

    abortControllerRef.current = new AbortController()
    chunksRef.current = splitIntoChunks(sanitizedText)
    
    playChunk(0)
    
    return true
  }, [ttsConfig, stop, playChunk])

  const value = {
    speak,
    stop,
    state,
    error,
    currentText,
    isEnabled,
    isPlaying: state === 'playing',
    isLoading: state === 'loading',
    isIdle: state === 'idle',
  }

  return (
    <TTSContext.Provider value={value}>
      {children}
    </TTSContext.Provider>
  )
}
