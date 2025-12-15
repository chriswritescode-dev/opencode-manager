import { Hono } from 'hono'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { SettingsService } from '../services/settings'
import { logger } from '../utils/logger'
import { getWorkspacePath } from '@opencode-manager/shared'

const TTS_CACHE_DIR = join(getWorkspacePath(), 'cache', 'tts')
const DISCOVERY_CACHE_DIR = join(getWorkspacePath(), 'cache', 'discovery')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour for discovery cache

const TTSRequestSchema = z.object({
  text: z.string().min(1).max(4096),
})

function generateCacheKey(text: string, voice: string, model: string, speed: number): string {
  const hash = createHash('sha256')
  hash.update(`${text}|${voice}|${model}|${speed}`)
  return hash.digest('hex')
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(TTS_CACHE_DIR, { recursive: true })
}

async function ensureDiscoveryCacheDir(): Promise<void> {
  await mkdir(DISCOVERY_CACHE_DIR, { recursive: true })
}

async function getCachedAudio(cacheKey: string): Promise<Buffer | null> {
  try {
    const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
    const fileStat = await stat(filePath)
    
    if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }
    
    return await readFile(filePath)
  } catch {
    return null
  }
}

async function cacheAudio(cacheKey: string, audioData: Buffer): Promise<void> {
  const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
  await writeFile(filePath, audioData)
}

async function getCachedDiscovery(cacheKey: string): Promise<string[] | null> {
  try {
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    const fileStat = await stat(filePath)
    
    if (Date.now() - fileStat.mtimeMs > DISCOVERY_CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }
    
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function cacheDiscovery(cacheKey: string, data: string[]): Promise<void> {
  try {
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    await writeFile(filePath, JSON.stringify(data))
  } catch (error) {
    logger.error(`Failed to cache discovery data for ${cacheKey}:`, error)
  }
}

function generateDiscoveryCacheKey(endpoint: string, apiKey: string, type: 'models' | 'voices'): string {
  const hash = createHash('sha256')
  hash.update(`${endpoint}|${apiKey.substring(0, 8)}|${type}`)
  return hash.digest('hex')
}

async function fetchAvailableModels(endpoint: string, apiKey: string): Promise<string[]> {
  // Try different endpoint formats for models
  const endpointVariations = [
    `${endpoint.replace(/\/audio\/speech$/, '')}/v1/models`,
    `${endpoint.replace(/\/audio\/speech$/, '')}/models`,
    `${endpoint.replace(/\/v1\/audio\/speech$/, '')}/v1/models`,
  ]
  
  for (const modelEndpoint of endpointVariations) {
    try {
      const response = await fetch(modelEndpoint, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (response.ok) {
        const data = await response.json() as { data?: { id?: string }[] } | unknown[]
        
        // Handle different response formats
        if ('data' in data && Array.isArray(data.data)) {
          // OpenAI format: { data: [{ id: "gpt-4" }, ...] }
          return data.data
            .filter((model) => model.id && typeof model.id === 'string')
            .filter((model) => 
              model.id!.toLowerCase().includes('tts') || 
              model.id!.toLowerCase().includes('audio') ||
              model.id!.toLowerCase().includes('speech')
            )
            .map((model) => model.id!)
        } else if (Array.isArray(data)) {
          return data.filter((item): item is string => typeof item === 'string')
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch models from ${modelEndpoint}:`, error)
      continue
    }
  }
  
  return ['tts-1', 'tts-1-hd']
}

async function fetchAvailableVoices(endpoint: string, apiKey: string): Promise<string[]> {
  // Try different endpoint formats for voices
  const endpointVariations = [
    `${endpoint.replace(/\/audio\/speech$/, '')}/v1/audio/voices`,
    `${endpoint.replace(/\/audio\/speech$/, '')}/voices`,
    `${endpoint.replace(/\/v1\/audio\/speech$/, '')}/v1/audio/voices`,
    `${endpoint.replace(/\/v1\/audio\/speech$/, '')}/audio/voices`,
  ]
  
  for (const voiceEndpoint of endpointVariations) {
    try {
      const response = await fetch(voiceEndpoint, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (response.ok) {
        type VoiceItem = { id?: string; name?: string; voice?: string }
        const data = await response.json() as { data?: VoiceItem[] } | (string | VoiceItem)[]
        
        // Handle different response formats
        if ('data' in data && Array.isArray(data.data)) {
          // OpenAI-style format: { data: [{ name: "alloy" }, ...] }
          return data.data
            .filter((voice) => voice.id || voice.name)
            .map((voice) => (voice.id || voice.name)!)
        } else if (Array.isArray(data)) {
          // Simple array format: ["alloy", "echo", ...] or [{ voice: "alloy" }, ...]
          return data.map((item) => {
            if (typeof item === 'string') return item
            return item.name || item.voice || item.id
          }).filter((v): v is string => typeof v === 'string')
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch voices from ${voiceEndpoint}:`, error)
      continue
    }
  }
  
  return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
}

export async function cleanupExpiredCache(): Promise<number> {
  try {
    await ensureCacheDir()
    const files = await readdir(TTS_CACHE_DIR)
    let cleanedCount = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      try {
        const fileStat = await stat(filePath)
        if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
          await unlink(filePath)
          cleanedCount++
        }
      } catch {
        continue
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`TTS cache cleanup: removed ${cleanedCount} expired files`)
    }
    
    return cleanedCount
  } catch (error) {
    logger.error('TTS cache cleanup failed:', error)
    return 0
  }
}

export function createTTSRoutes(db: Database) {
  const app = new Hono()

  app.post('/synthesize', async (c) => {
    try {
      const body = await c.req.json()
      const { text } = TTSRequestSchema.parse(body)
      const userId = c.req.query('userId') || 'default'
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.enabled) {
        return c.json({ error: 'TTS is not enabled' }, 400)
      }
      
      if (!ttsConfig.apiKey) {
        return c.json({ error: 'TTS API key is not configured' }, 400)
      }
      
      const { endpoint, apiKey, voice, model, speed } = ttsConfig
      const cacheKey = generateCacheKey(text, voice, model, speed)
      
      await ensureCacheDir()
      
      const cachedAudio = await getCachedAudio(cacheKey)
      if (cachedAudio) {
        logger.info(`TTS cache hit: ${cacheKey.substring(0, 8)}...`)
        return new Response(cachedAudio, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'X-Cache': 'HIT',
          },
        })
      }
      
      logger.info(`TTS cache miss, calling API: ${cacheKey.substring(0, 8)}...`)
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          speed,
          response_format: 'mp3',
        }),
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`TTS API error: ${response.status} - ${errorText}`)
        const status = response.status >= 400 && response.status < 600 ? response.status as 400 | 500 : 500
        return c.json({ error: 'TTS API request failed', details: errorText }, status)
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer())
      
      await cacheAudio(cacheKey, audioBuffer)
      logger.info(`TTS audio cached: ${cacheKey.substring(0, 8)}...`)
      
      return new Response(audioBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'X-Cache': 'MISS',
        },
      })
    } catch (error) {
      logger.error('TTS synthesis failed:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      return c.json({ error: 'TTS synthesis failed' }, 500)
    }
  })

  app.get('/models', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const forceRefresh = c.req.query('refresh') === 'true'
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.apiKey || !ttsConfig?.endpoint) {
        return c.json({ error: 'TTS not configured' }, 400)
      }
      
      const cacheKey = generateDiscoveryCacheKey(ttsConfig.endpoint, ttsConfig.apiKey, 'models')
      
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedModels = await getCachedDiscovery(cacheKey)
        if (cachedModels) {
          logger.info(`Models cache hit for user ${userId}`)
          return c.json({ models: cachedModels, cached: true })
        }
      }
      
      // Fetch from API
      await ensureDiscoveryCacheDir()
      logger.info(`Fetching TTS models for user ${userId}`)
      
      const models = await fetchAvailableModels(ttsConfig.endpoint, ttsConfig.apiKey)
      await cacheDiscovery(cacheKey, models)
      
      logger.info(`Fetched ${models.length} TTS models`)
      return c.json({ models, cached: false })
    } catch (error) {
      logger.error('Failed to fetch TTS models:', error)
      return c.json({ error: 'Failed to fetch models' }, 500)
    }
  })

  app.get('/voices', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const forceRefresh = c.req.query('refresh') === 'true'
      
      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const ttsConfig = settings.preferences.tts
      
      if (!ttsConfig?.apiKey || !ttsConfig?.endpoint) {
        return c.json({ error: 'TTS not configured' }, 400)
      }
      
      const cacheKey = generateDiscoveryCacheKey(ttsConfig.endpoint, ttsConfig.apiKey, 'voices')
      
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedVoices = await getCachedDiscovery(cacheKey)
        if (cachedVoices) {
          logger.info(`Voices cache hit for user ${userId}`)
          return c.json({ voices: cachedVoices, cached: true })
        }
      }
      
      // Fetch from API
      await ensureDiscoveryCacheDir()
      logger.info(`Fetching TTS voices for user ${userId}`)
      
      const voices = await fetchAvailableVoices(ttsConfig.endpoint, ttsConfig.apiKey)
      await cacheDiscovery(cacheKey, voices)
      
      logger.info(`Fetched ${voices.length} TTS voices`)
      return c.json({ voices, cached: false })
    } catch (error) {
      logger.error('Failed to fetch TTS voices:', error)
      return c.json({ error: 'Failed to fetch voices' }, 500)
    }
  })

  app.get('/status', async (c) => {
    const userId = c.req.query('userId') || 'default'
    const settingsService = new SettingsService(db)
    const settings = settingsService.getSettings(userId)
    const ttsConfig = settings.preferences.tts
    
    return c.json({
      enabled: ttsConfig?.enabled || false,
      configured: !!(ttsConfig?.apiKey),
    })
  })

  return app
}
