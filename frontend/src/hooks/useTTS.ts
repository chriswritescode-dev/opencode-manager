import { useState, useRef, useCallback, useEffect } from 'react'
import { useSettings } from './useSettings'
import { API_BASE_URL } from '@/config'

const TTS_CACHE_NAME = 'tts-audio-cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const PUNCTUATION_REGEX = /(?<=[.!?;])\s+/
const AUDIO_PLAYBACK_MAX_RETRIES = 3
const AUDIO_PLAYBACK_RETRY_DELAY_MS = 50
const AUDIO_LOAD_TIMEOUT_MS = 5000

function generateCacheKey(text: string, voice: string, model: string, speed: number): string {
  const data = `${text}|${voice}|${model}|${speed}`
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function isCacheApiAvailable(): boolean {
  return typeof caches !== 'undefined'
}

async function getCachedAudio(cacheKey: string): Promise<Blob | null> {
  if (!isCacheApiAvailable()) return null
  
  try {
    const cache = await caches.open(TTS_CACHE_NAME)
    const response = await cache.match(cacheKey)
    
    if (!response) return null
    
    const cachedAt = response.headers.get('x-cached-at')
    if (cachedAt && Date.now() - parseInt(cachedAt) > CACHE_TTL_MS) {
      await cache.delete(cacheKey)
      return null
    }
    
    return await response.blob()
  } catch {
    return null
  }
}

async function cacheAudio(cacheKey: string, blob: Blob): Promise<void> {
  if (!isCacheApiAvailable()) return
  
  try {
    const cache = await caches.open(TTS_CACHE_NAME)
    const headers = new Headers({
      'Content-Type': 'audio/mpeg',
      'x-cached-at': Date.now().toString(),
    })
    const response = new Response(blob, { headers })
    await cache.put(cacheKey, response)
  } catch {
    // Cache API not available or storage full, continue without caching
  }
}

export type TTSState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

function splitTextByPunctuation(text: string): string[] {
  const chunks = text.split(PUNCTUATION_REGEX).filter(chunk => chunk.trim().length > 0)
  return chunks.length > 0 ? chunks : [text]
}

export function useTTS() {
  const { preferences } = useSettings()
  const [state, setState] = useState<TTSState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentText, setCurrentText] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const chunkQueueRef = useRef<string[]>([])
  const isPlayingChunksRef = useRef<boolean>(false)
  const fullTextRef = useRef<string | null>(null)

  const ttsConfig = preferences?.tts
  const isEnabled = ttsConfig?.enabled && ttsConfig?.apiKey

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
    chunkQueueRef.current = []
    isPlayingChunksRef.current = false
  }, [])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  const synthesizeChunk = useCallback(async (text: string): Promise<Blob | null> => {
    if (!isPlayingChunksRef.current) return null
    
    const { voice, model, speed } = ttsConfig!
    const cacheKey = generateCacheKey(text, voice, model, speed ?? 1)
    
    const cachedBlob = await getCachedAudio(cacheKey)
    if (!isPlayingChunksRef.current) return null
    if (cachedBlob) return cachedBlob
    
    abortControllerRef.current = new AbortController()
    
    const response = await fetch(`${API_BASE_URL}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: abortControllerRef.current.signal,
    })
    
    if (!isPlayingChunksRef.current) return null
    
    if (!response.ok) {
      let errorMessage = 'TTS request failed'
      try {
        const errorData = await response.json()
        errorMessage = errorData.error || errorData.details || errorMessage
      } catch {
        if (response.status === 401) errorMessage = 'Invalid TTS API key'
        else if (response.status === 429) errorMessage = 'TTS rate limit exceeded'
        else if (response.status >= 500) errorMessage = 'TTS service unavailable'
      }
      throw new Error(errorMessage)
    }
    
    const contentType = response.headers.get('content-type')
    if (!contentType?.includes('audio')) throw new Error('Invalid response from TTS service')
    
    const audioBlob = await response.blob()
    if (!isPlayingChunksRef.current) return null
    if (audioBlob.size === 0) throw new Error('Empty audio response from TTS service')
    
    await cacheAudio(cacheKey, audioBlob)
    return audioBlob
  }, [ttsConfig])

  const playNextChunk = useCallback(async () => {
    if (!isPlayingChunksRef.current || chunkQueueRef.current.length === 0) {
      isPlayingChunksRef.current = false
      fullTextRef.current = null
      setState('idle')
      setCurrentText(null)
      return
    }
    
    const chunk = chunkQueueRef.current.shift()!
    
    try {
      const audioBlob = await synthesizeChunk(chunk)
      
      if (!audioBlob || !isPlayingChunksRef.current) return
      
      const playAudioBlob = async (blob: Blob, retries = AUDIO_PLAYBACK_MAX_RETRIES): Promise<void> => {
        let lastError: Error | null = null
        
        for (let attempt = 1; attempt <= retries; attempt++) {
          if (!isPlayingChunksRef.current) return
          
          const typedBlob = new Blob([blob], { type: 'audio/mpeg' })
          const audioUrl = URL.createObjectURL(typedBlob)
          const audio = new Audio()
          
          try {
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error('Audio load timeout'))
              }, AUDIO_LOAD_TIMEOUT_MS)
              
              audio.oncanplaythrough = () => {
                clearTimeout(timeoutId)
                resolve()
              }
              
              audio.onerror = () => {
                clearTimeout(timeoutId)
                reject(new Error(audio.error?.message || 'Audio load failed'))
              }
              
              audio.src = audioUrl
              audio.load()
            })
            
            if (!isPlayingChunksRef.current) {
              URL.revokeObjectURL(audioUrl)
              return
            }
            
            audioRef.current = audio
            
            audio.onplay = () => setState('playing')
            audio.onpause = () => {
              if (audio.currentTime < audio.duration) setState('paused')
            }
            audio.onended = () => {
              URL.revokeObjectURL(audioUrl)
              playNextChunk()
            }
            audio.onerror = () => {
              URL.revokeObjectURL(audioUrl)
            }
            
            await audio.play()
            return
          } catch (err) {
            URL.revokeObjectURL(audioUrl)
            lastError = err instanceof Error ? err : new Error('Unknown error')
            
            if (attempt < retries) {
              await new Promise(r => setTimeout(r, AUDIO_PLAYBACK_RETRY_DELAY_MS * attempt))
            }
          }
        }
        
        throw lastError || new Error('Audio playback failed after retries')
      }
      
      await playAudioBlob(audioBlob)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setState('idle')
        return
      }
      setError(err instanceof Error ? err.message : 'TTS failed')
      setState('error')
      isPlayingChunksRef.current = false
    }
  }, [synthesizeChunk])

  const speak = useCallback(async (text: string) => {
    if (!ttsConfig?.enabled) {
      setError('TTS is not enabled in settings')
      setState('error')
      return
    }

    if (!ttsConfig?.apiKey) {
      setError('TTS API key is not configured')
      setState('error')
      return
    }

    if (!text?.trim()) {
      setError('No text provided for speech')
      setState('error')
      return
    }

    if (!ttsConfig.voice || !ttsConfig.model) {
      setError('TTS voice or model not configured')
      setState('error')
      return
    }

    cleanup()
    setError(null)
    setState('loading')
    setCurrentText(text)
    fullTextRef.current = text

    const chunks = splitTextByPunctuation(text)
    chunkQueueRef.current = chunks
    isPlayingChunksRef.current = true
    
    await playNextChunk()
  }, [ttsConfig, cleanup, playNextChunk])

  const stop = useCallback(() => {
    cleanup()
    fullTextRef.current = null
    setState('idle')
    setCurrentText(null)
    setError(null)
  }, [cleanup])

  const pause = useCallback(() => {
    if (audioRef.current && state === 'playing') {
      audioRef.current.pause()
    }
  }, [state])

  const resume = useCallback(() => {
    if (audioRef.current && state === 'paused') {
      audioRef.current.play()
    }
  }, [state])

  const toggle = useCallback(() => {
    if (state === 'playing') {
      pause()
    } else if (state === 'paused') {
      resume()
    }
  }, [state, pause, resume])

  return {
    speak,
    stop,
    pause,
    resume,
    toggle,
    state,
    error,
    currentText,
    isEnabled,
    isPlaying: state === 'playing',
    isLoading: state === 'loading',
    isPaused: state === 'paused',
    isIdle: state === 'idle',
  }
}
