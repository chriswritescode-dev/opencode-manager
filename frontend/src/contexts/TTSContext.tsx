import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { API_BASE_URL } from '@/config'
import { TTSContext, type TTSState, type TTSConfig } from './tts-context'
import { sanitizeForTTS } from '@/lib/utils'
import { getWebSpeechSynthesizer, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'
import { authFetch } from '@/lib/auth'

export { TTSContext, type TTSContextValue, type TTSState, type TTSConfig } from './tts-context'

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
  const [originalText, setOriginalText] = useState<string | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stoppedRef = useRef(false)
  const chunksRef = useRef<string[]>([])
  const chunkIndexRef = useRef(0)
  const prefetchedBlobsRef = useRef<Map<number, Blob>>(new Map())
  const fetchingIndexRef = useRef<number>(-1)
  
  // Web Speech API reference
  const webSpeechSynthRef = useRef<ReturnType<typeof getWebSpeechSynthesizer> | null>(null)

  const ttsConfig = preferences?.tts
  const isBuiltin = ttsConfig?.provider === 'builtin'
  const isChatterbox = ttsConfig?.provider === 'chatterbox'
  const isEnabled = (() => {
    if (!ttsConfig?.enabled) return false
    if (isBuiltin) {
      return isWebSpeechSupported()
    }
    if (isChatterbox) {
      // Chatterbox doesn't require API key
      return true
    }
    // External requires apiKey
    return !!ttsConfig?.apiKey
  })()

  // Initialize Web Speech synthesizer on demand
  const getSynthesizer = useCallback(() => {
    if (!webSpeechSynthRef.current) {
      webSpeechSynthRef.current = getWebSpeechSynthesizer();
    }
    return webSpeechSynthRef.current;
  }, []);

  const cleanup = useCallback(() => {
    // Stop external audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    
    // Stop Web Speech API
    if (webSpeechSynthRef.current && isBuiltin) {
      webSpeechSynthRef.current.stop()
      webSpeechSynthRef.current.clearCallbacks()
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
  }, [isBuiltin])

  const stop = useCallback(() => {
    stoppedRef.current = true
    cleanup()
    setState('idle')
    setCurrentText(null)
    setOriginalText(null)
    setError(null)
  }, [cleanup])

  useEffect(() => {
    return () => {
      stoppedRef.current = true
      cleanup()
    }
  }, [cleanup])

  // External API synthesis
  const synthesizeExternal = useCallback(async (text: string, signal?: AbortSignal): Promise<Blob | null> => {
    if (stoppedRef.current) return null

    try {
      const response = await authFetch(`${API_BASE_URL}/api/tts/synthesize`, {
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
      const blob = await synthesizeExternal(chunksRef.current[index], abortControllerRef.current?.signal)
      if (blob && !stoppedRef.current) {
        prefetchedBlobsRef.current.set(index, blob)
        fetchNextChunk(index + 1)
      }
    } catch {
      if (stoppedRef.current) return
    }
    
    fetchingIndexRef.current = -1
  }, [synthesizeExternal])

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
        const fetched = await synthesizeExternal(chunksRef.current[index], abortControllerRef.current?.signal)
        if (fetched && !stoppedRef.current) {
          blob = fetched
        }
        fetchNextChunk(index + 1)
      }
      
      if (!blob || stoppedRef.current) return

      prefetchedBlobsRef.current.delete(index)
      
      const url = URL.createObjectURL(blob)
      let urlRevoked = false
      const revokeUrl = () => {
        if (!urlRevoked) {
          urlRevoked = true
          URL.revokeObjectURL(url)
        }
      }
      
      try {
        const audio = new Audio(url)
        audioRef.current = audio

        audio.onended = () => {
          revokeUrl()
          audioRef.current = null
          if (!stoppedRef.current) {
            playChunk(index + 1)
          }
        }

        audio.onerror = () => {
          revokeUrl()
          audioRef.current = null
          if (!stoppedRef.current) {
            setError('Audio playback failed')
            setState('error')
          }
        }

        setState('playing')
        await audio.play()
      } catch (playErr) {
        revokeUrl()
        audioRef.current = null
        throw playErr
      }
    } catch (err) {
      if (stoppedRef.current) return
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
    }
  }, [synthesizeExternal, fetchNextChunk])

  // Builtin Web Speech synthesis - takes explicit config
  const speakBuiltinWithConfig = useCallback(async (text: string, config: TTSConfig): Promise<boolean> => {
    if (!isWebSpeechSupported()) {
      setError('Web Speech API not supported in this browser')
      setState('error')
      return false
    }

    if (!text?.trim()) {
      setError('No text provided')
      setState('error')
      return false
    }

    const sanitizedText = sanitizeForTTS(text)
    
    if (!sanitizedText?.trim()) {
      setError('No readable content after sanitization')
      setState('error')
      return false
    }

    stop()
    stoppedRef.current = false
    setError(null)

    setOriginalText(text)
    setCurrentText(sanitizedText)
    setState('loading')

    const synth = getSynthesizer()
    await synth.waitForVoices()

    const voiceName = config.voice || ''
    
    synth.clearCallbacks()
    
    synth.onEnd(() => {
      if (!stoppedRef.current) {
        setState('idle')
        setCurrentText(null)
      }
    })

    synth.onError((err) => {
      if (!stoppedRef.current) {
        setError(err)
        setState('error')
      }
    })

    try {
      setState('playing')
      
      const rate = config.speed || 1.0
      
      await synth.speakChunked(sanitizedText, 200, {
        voice: voiceName || undefined,
        rate: rate,
      })
      
      return true
    } catch (err) {
      if (stoppedRef.current) return false
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
      return false
    }
  }, [stop, getSynthesizer])

  // Config-aware speak function - takes explicit config
  const speakWithConfig = useCallback(async (text: string, config: TTSConfig): Promise<boolean> => {
    if (!config.enabled) {
      setError('TTS is not enabled')
      setState('error')
      return false
    }

    const configIsBuiltin = config.provider === 'builtin'
    const configIsChatterbox = config.provider === 'chatterbox'

    if (configIsBuiltin) {
      if (!isWebSpeechSupported()) {
        setError('Web Speech API not supported in this browser')
        setState('error')
        return false
      }
      return speakBuiltinWithConfig(text, config)
    } else if (configIsChatterbox) {
      // Chatterbox doesn't require API key - handled by backend
    } else {
      // External provider requires API key
      if (!config.apiKey) {
        setError('API key not configured')
        setState('error')
        return false
      }

      if (!config.voice || !config.model) {
        setError('Voice or model not configured')
        setState('error')
        return false
      }
    }

    // Both chatterbox and external providers use the backend API
    const sanitizedText = sanitizeForTTS(text)
    
    if (!sanitizedText?.trim()) {
      setError('No readable content after sanitization')
      setState('error')
      return false
    }

    stop()
    stoppedRef.current = false
    setError(null)

    setOriginalText(text)
    setCurrentText(sanitizedText)

    abortControllerRef.current = new AbortController()
    chunksRef.current = splitIntoChunks(sanitizedText)
    
    playChunk(0)
    
    return true
  }, [speakBuiltinWithConfig, stop, playChunk])

  // Main speak function - uses stored preferences
  const speak = useCallback(async (text: string): Promise<boolean> => {
    if (!ttsConfig) {
      setError('TTS is not configured')
      setState('error')
      return false
    }

    const config: TTSConfig = {
      enabled: ttsConfig.enabled ?? false,
      provider: ttsConfig.provider ?? 'external',
      endpoint: ttsConfig.endpoint ?? '',
      apiKey: ttsConfig.apiKey ?? '',
      voice: ttsConfig.voice ?? '',
      model: ttsConfig.model ?? '',
      speed: ttsConfig.speed ?? 1.0,
    }

    return speakWithConfig(text, config)
  }, [ttsConfig, speakWithConfig])

  const value = {
    speak,
    speakWithConfig,
    stop,
    state,
    error,
    currentText,
    originalText,
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
