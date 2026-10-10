import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { API_BASE_URL } from '@/config'
import { TTSContext, type TTSState, type TTSConfig } from './tts-context'
import { sanitizeForTTS } from '@/lib/utils'
import { getWebSpeechSynthesizer, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'

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
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackIdRef = useRef(0)
  const currentObjectUrlRef = useRef<string | null>(null)
  const chunksRef = useRef<string[]>([])
  const chunkIndexRef = useRef(0)
  const chunkAudioRef = useRef<Map<number, Promise<Blob | null>>>(new Map())
  
  // Web Speech API reference
  const webSpeechSynthRef = useRef<ReturnType<typeof getWebSpeechSynthesizer> | null>(null)

  const ttsConfig = preferences?.tts
  const isBuiltin = ttsConfig?.provider === 'builtin'
  const isEnabled = (() => {
    if (!ttsConfig?.enabled) return false
    if (isBuiltin) {
      return isWebSpeechSupported()
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
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }

    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current)
      currentObjectUrlRef.current = null
    }

    if (webSpeechSynthRef.current) {
      webSpeechSynthRef.current.stop()
      webSpeechSynthRef.current.clearCallbacks()
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    chunkAudioRef.current.clear()
    chunksRef.current = []
    chunkIndexRef.current = 0
  }, [])

  const stop = useCallback(() => {
    playbackIdRef.current += 1
    cleanup()
    setState('idle')
    setCurrentText(null)
    setOriginalText(null)
    setActiveMessageId(null)
    setError(null)
  }, [cleanup])

  useEffect(() => {
    return () => {
      playbackIdRef.current += 1
      cleanup()
    }
  }, [cleanup])

  // External API synthesis
  const synthesizeExternal = useCallback(async (text: string, signal: AbortSignal | undefined, playbackId: number): Promise<Blob | null> => {
    if (playbackIdRef.current !== playbackId) return null

    try {
      const response = await fetch(`${API_BASE_URL}/api/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      })

      if (playbackIdRef.current !== playbackId) return null

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

  const getChunkAudio = useCallback((index: number, playbackId: number): Promise<Blob | null> => {
    const existing = chunkAudioRef.current.get(index)
    if (existing) return existing

    const promise = synthesizeExternal(chunksRef.current[index], abortControllerRef.current?.signal, playbackId)
    chunkAudioRef.current.set(index, promise)
    return promise
  }, [synthesizeExternal])

  const prefetchChunk = useCallback((index: number, playbackId: number) => {
    if (playbackIdRef.current !== playbackId) return
    if (index >= chunksRef.current.length) return
    if (chunkAudioRef.current.has(index)) return

    getChunkAudio(index, playbackId)
      .then((blob) => {
        if (!blob || playbackIdRef.current !== playbackId) return
        prefetchChunk(index + 1, playbackId)
      })
      .catch(() => {})
  }, [getChunkAudio])

  const playChunk = useCallback(async (index: number, playbackId: number) => {
    if (playbackIdRef.current !== playbackId || index >= chunksRef.current.length) {
      if (playbackIdRef.current === playbackId) {
        setState('idle')
        setCurrentText(null)
        setActiveMessageId(null)
      }
      return
    }

    chunkIndexRef.current = index

    try {
      if (!chunkAudioRef.current.has(index)) {
        setState('loading')
      }

      const blob = await getChunkAudio(index, playbackId)
      if (!blob || playbackIdRef.current !== playbackId) return

      chunkAudioRef.current.delete(index)
      prefetchChunk(index + 1, playbackId)

      const url = URL.createObjectURL(blob)
      currentObjectUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        if (playbackIdRef.current !== playbackId) return
        if (currentObjectUrlRef.current === url) {
          URL.revokeObjectURL(url)
          currentObjectUrlRef.current = null
        }
        if (audioRef.current === audio) {
          audioRef.current = null
        }
        playChunk(index + 1, playbackId)
      }

      audio.onerror = () => {
        if (playbackIdRef.current !== playbackId) return
        if (currentObjectUrlRef.current === url) {
          URL.revokeObjectURL(url)
          currentObjectUrlRef.current = null
        }
        if (audioRef.current === audio) {
          audioRef.current = null
        }
        setError('Audio playback failed')
        setState('error')
      }

      setState('playing')
      await audio.play()
    } catch (err) {
      if (playbackIdRef.current !== playbackId) return
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
    }
  }, [getChunkAudio, prefetchChunk])

  // Builtin Web Speech synthesis - takes explicit config and optional messageId
  const speakBuiltinWithConfig = useCallback(async (text: string, config: TTSConfig, messageId: string | null = null): Promise<boolean> => {
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
    const playbackId = playbackIdRef.current
    setError(null)

    setOriginalText(text)
    setCurrentText(sanitizedText)
    if (messageId) {
      setActiveMessageId(messageId)
    } else {
      setActiveMessageId(null)
    }
    setState('loading')

    const synth = getSynthesizer()
    await synth.waitForVoices()

    if (playbackIdRef.current !== playbackId) return false

    const voiceName = config.voice || ''

    synth.clearCallbacks()

    synth.onEnd(() => {
      if (playbackIdRef.current !== playbackId) return
      setState('idle')
      setCurrentText(null)
      setActiveMessageId(null)
    })

    synth.onError((err) => {
      if (playbackIdRef.current !== playbackId) return
      setError(err)
      setState('error')
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
      if (playbackIdRef.current !== playbackId) return false
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
      return false
    }
  }, [stop, getSynthesizer])

  // Internal helper to start external TTS playback
  const startExternalPlayback = useCallback((sanitizedText: string, original: string, messageId: string | null): boolean => {
    stop()
    const playbackId = playbackIdRef.current
    setError(null)

    setOriginalText(original)
    setCurrentText(sanitizedText)
    if (messageId) {
      setActiveMessageId(messageId)
    } else {
      setActiveMessageId(null)
    }

    abortControllerRef.current = new AbortController()
    chunksRef.current = splitIntoChunks(sanitizedText)

    playChunk(0, playbackId)

    return true
  }, [stop, playChunk])

  // Config-aware speak function - takes explicit config and optional messageId
  const speakWithConfig = useCallback(async (text: string, config: TTSConfig, messageId: string | null = null): Promise<boolean> => {
    if (!config.enabled) {
      setError('TTS is not enabled')
      setState('error')
      return false
    }

    const configIsBuiltin = config.provider === 'builtin'

    if (configIsBuiltin) {
      if (!isWebSpeechSupported()) {
        setError('Web Speech API not supported in this browser')
        setState('error')
        return false
      }
      return speakBuiltinWithConfig(text, config, messageId)
    } else {
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

      const sanitizedText = sanitizeForTTS(text)
      
      if (!sanitizedText?.trim()) {
        setError('No readable content after sanitization')
        setState('error')
        return false
      }

      return startExternalPlayback(sanitizedText, text, messageId)
    }
  }, [speakBuiltinWithConfig, startExternalPlayback])

  // Message-aware speak function - tracks active message id
  const speakMessage = useCallback(async (messageId: string, text: string): Promise<boolean> => {
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

    return speakWithConfig(text, config, messageId)
  }, [ttsConfig, speakWithConfig])

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
    speakMessage,
    stop,
    state,
    error,
    currentText,
    originalText,
    activeMessageId,
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
