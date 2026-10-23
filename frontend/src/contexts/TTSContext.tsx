import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { API_BASE_URL } from '@/config'
import { TTSContext, type TTSState, type TTSConfig, type TTSEndReason, type SpeakMessageOptions } from './tts-context'
import { sanitizeForTTS } from '@/lib/utils'
import { getWebSpeechSynthesizer, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'

export {
  TTSContext,
  type TTSContextValue,
  type TTSState,
  type TTSConfig,
  type TTSEndReason,
  type SpeakMessageOptions,
} from './tts-context'

const SENTENCE_REGEX = /(?<=[.!?])\s+/
const SENTENCES_PER_CHUNK = 2
const QUEUE_PAUSE_MS = 600

interface QueuedMessage {
  messageId: string
  text: string
}

interface SpeechRequest {
  onEnd?: (reason: TTSEndReason) => void
}

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
  const { isAuthenticated } = useAuth()
  const { preferences } = useSettings('default', { enabled: isAuthenticated })
  const [state, setState] = useState<TTSState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentText, setCurrentText] = useState<string | null>(null)
  const [originalText, setOriginalText] = useState<string | null>(null)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackIdRef = useRef(0)
  const currentObjectUrlRef = useRef<string | null>(null)
  const chunksRef = useRef<string[]>([])
  const chunkIndexRef = useRef(0)
  const chunkAudioRef = useRef<Map<number, Promise<Blob | null>>>(new Map())
  const queueRef = useRef<QueuedMessage[]>([])
  const busyRef = useRef(false)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playMessageRef = useRef<((messageId: string, text: string) => Promise<boolean>) | null>(null)
  const speechRequestRef = useRef<SpeechRequest | null>(null)
  const activeProviderRef = useRef<TTSConfig['provider'] | null>(null)
  const pausedRef = useRef(false)
  
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

  const settleSpeechRequest = useCallback((reason: TTSEndReason) => {
    const request = speechRequestRef.current
    speechRequestRef.current = null
    request?.onEnd?.(reason)
  }, [])

  const beginSpeechRequest = useCallback((onEnd?: (reason: TTSEndReason) => void) => {
    const previous = speechRequestRef.current
    speechRequestRef.current = { onEnd }
    previous?.onEnd?.('stopped')
  }, [])

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [])

  const clearQueue = useCallback(() => {
    queueRef.current = []
    clearAdvanceTimer()
  }, [clearAdvanceTimer])

  const resetPlayback = useCallback(() => {
    clearAdvanceTimer()
    playbackIdRef.current += 1
    cleanup()
    activeProviderRef.current = null
    pausedRef.current = false
    setIsPaused(false)
    setState('idle')
    setCurrentText(null)
    setOriginalText(null)
    setActiveMessageId(null)
    setError(null)
  }, [cleanup, clearAdvanceTimer])

  const stop = useCallback(() => {
    settleSpeechRequest('stopped')
    clearQueue()
    busyRef.current = false
    resetPlayback()
  }, [clearQueue, resetPlayback, settleSpeechRequest])

  const failPlayback = useCallback(() => {
    clearQueue()
    busyRef.current = false
    activeProviderRef.current = null
    pausedRef.current = false
    setIsPaused(false)
    setActiveMessageId(null)
    settleSpeechRequest('error')
  }, [clearQueue, settleSpeechRequest])

  const advanceQueue = useCallback((playbackId: number) => {
    if (playbackIdRef.current !== playbackId) return

    clearAdvanceTimer()
    const next = queueRef.current.shift()

    activeProviderRef.current = null
    pausedRef.current = false
    setIsPaused(false)
    setState('idle')
    setCurrentText(null)
    setActiveMessageId(null)

    if (!next) {
      busyRef.current = false
      return
    }

    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null
      if (playbackIdRef.current !== playbackId) return
      void playMessageRef.current?.(next.messageId, next.text)
    }, QUEUE_PAUSE_MS)
  }, [clearAdvanceTimer])

  useEffect(() => {
    return () => {
      settleSpeechRequest('stopped')
      clearAdvanceTimer()
      queueRef.current = []
      busyRef.current = false
      playbackIdRef.current += 1
      cleanup()
    }
  }, [cleanup, clearAdvanceTimer, settleSpeechRequest])

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
    if (playbackIdRef.current !== playbackId) return

    if (index >= chunksRef.current.length) {
      advanceQueue(playbackId)
      settleSpeechRequest('completed')
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
        failPlayback()
        setError('Audio playback failed')
        setState('error')
      }

      setState('playing')
      if (!pausedRef.current) {
        await audio.play()
      }
    } catch (err) {
      if (playbackIdRef.current !== playbackId) return
      failPlayback()
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
    }
  }, [getChunkAudio, prefetchChunk, advanceQueue, failPlayback, settleSpeechRequest])

  // Builtin Web Speech synthesis - takes explicit config and optional messageId
  const speakBuiltinWithConfig = useCallback(async (text: string, config: TTSConfig, messageId: string | null = null): Promise<boolean> => {
    if (!isWebSpeechSupported()) {
      failPlayback()
      setError('Web Speech API not supported in this browser')
      setState('error')
      return false
    }

    if (!text?.trim()) {
      failPlayback()
      setError('No text provided')
      setState('error')
      return false
    }

    const sanitizedText = sanitizeForTTS(text)
    
    if (!sanitizedText?.trim()) {
      failPlayback()
      setError('No readable content after sanitization')
      setState('error')
      return false
    }

    resetPlayback()
    busyRef.current = true
    activeProviderRef.current = 'builtin'
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

    synth.onError((err) => {
      if (playbackIdRef.current !== playbackId) return
      failPlayback()
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

      if (playbackIdRef.current !== playbackId) return false

      advanceQueue(playbackId)
      settleSpeechRequest('completed')
      return true
    } catch (err) {
      if (playbackIdRef.current !== playbackId) return false
      failPlayback()
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
      return false
    }
  }, [resetPlayback, advanceQueue, failPlayback, getSynthesizer, settleSpeechRequest])

  // Internal helper to start external TTS playback
  const startExternalPlayback = useCallback((sanitizedText: string, original: string, messageId: string | null): boolean => {
    resetPlayback()
    busyRef.current = true
    activeProviderRef.current = 'external'
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
  }, [resetPlayback, playChunk])

  const playWithConfig = useCallback(async (text: string, config: TTSConfig, messageId: string | null = null): Promise<boolean> => {
    if (!config.enabled) {
      failPlayback()
      setError('TTS is not enabled')
      setState('error')
      return false
    }

    const configIsBuiltin = config.provider === 'builtin'

    if (configIsBuiltin) {
      if (!isWebSpeechSupported()) {
        failPlayback()
        setError('Web Speech API not supported in this browser')
        setState('error')
        return false
      }
      return speakBuiltinWithConfig(text, config, messageId)
    }

    if (!config.apiKey) {
      failPlayback()
      setError('API key not configured')
      setState('error')
      return false
    }

    if (!config.voice || !config.model) {
      failPlayback()
      setError('Voice or model not configured')
      setState('error')
      return false
    }

    const sanitizedText = sanitizeForTTS(text)
    
    if (!sanitizedText?.trim()) {
      failPlayback()
      setError('No readable content after sanitization')
      setState('error')
      return false
    }

    return startExternalPlayback(sanitizedText, text, messageId)
  }, [speakBuiltinWithConfig, startExternalPlayback, failPlayback])

  const buildStoredConfig = useCallback((): TTSConfig | null => {
    if (!ttsConfig) return null

    return {
      enabled: ttsConfig.enabled ?? false,
      provider: ttsConfig.provider ?? 'external',
      endpoint: ttsConfig.endpoint ?? '',
      apiKey: ttsConfig.apiKey ?? '',
      voice: ttsConfig.voice ?? '',
      model: ttsConfig.model ?? '',
      speed: ttsConfig.speed ?? 1.0,
    }
  }, [ttsConfig])

  const playMessage = useCallback(async (messageId: string, text: string): Promise<boolean> => {
    const config = buildStoredConfig()

    if (!config) {
      failPlayback()
      setError('TTS is not configured')
      setState('error')
      return false
    }

    return playWithConfig(text, config, messageId)
  }, [buildStoredConfig, playWithConfig, failPlayback])

  useEffect(() => {
    playMessageRef.current = playMessage
  }, [playMessage])

  const speakWithConfig = useCallback(async (text: string, config: TTSConfig): Promise<boolean> => {
    clearQueue()
    beginSpeechRequest()
    return playWithConfig(text, config)
  }, [clearQueue, beginSpeechRequest, playWithConfig])

  const speakMessage = useCallback(async (
    messageId: string,
    text: string,
    options?: SpeakMessageOptions,
  ): Promise<boolean> => {
    clearQueue()
    beginSpeechRequest(options?.onEnd)
    return playMessage(messageId, text)
  }, [clearQueue, beginSpeechRequest, playMessage])

  const speak = useCallback(async (text: string): Promise<boolean> => {
    clearQueue()
    beginSpeechRequest()

    const config = buildStoredConfig()

    if (!config) {
      failPlayback()
      setError('TTS is not configured')
      setState('error')
      return false
    }

    return playWithConfig(text, config)
  }, [clearQueue, beginSpeechRequest, buildStoredConfig, playWithConfig, failPlayback])

  const pause = useCallback(() => {
    if (pausedRef.current) return

    const provider = activeProviderRef.current
    if (!provider) return

    if (provider === 'builtin') {
      getSynthesizer().pause()
    } else {
      audioRef.current?.pause()
    }

    pausedRef.current = true
    setIsPaused(true)
  }, [getSynthesizer])

  const resume = useCallback(() => {
    if (!pausedRef.current) return

    pausedRef.current = false
    setIsPaused(false)

    if (activeProviderRef.current === 'builtin') {
      getSynthesizer().resume()
      return
    }

    const audio = audioRef.current
    if (!audio) return

    void audio.play().catch((err: unknown) => {
      failPlayback()
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
    })
  }, [getSynthesizer, failPlayback])

  const queueMessage = useCallback((messageId: string, text: string) => {
    if (messageId === activeMessageId || queueRef.current.some((item) => item.messageId === messageId)) {
      return
    }

    if (busyRef.current) {
      queueRef.current.push({ messageId, text })
      return
    }

    void playMessage(messageId, text)
  }, [activeMessageId, playMessage])

  const value = {
    speak,
    speakWithConfig,
    speakMessage,
    queueMessage,
    stop,
    pause,
    resume,
    state,
    error,
    currentText,
    originalText,
    activeMessageId,
    isEnabled,
    isPlaying: state === 'playing',
    isLoading: state === 'loading',
    isIdle: state === 'idle',
    isPaused,
  }

  return (
    <TTSContext.Provider value={value}>
      {children}
    </TTSContext.Provider>
  )
}
