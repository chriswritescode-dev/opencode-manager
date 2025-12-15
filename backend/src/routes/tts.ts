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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_SIZE_MB = 200
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024

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

async function getCacheSize(): Promise<number> {
  try {
    const files = await readdir(TTS_CACHE_DIR)
    let totalSize = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      totalSize += fileStat.size
    }
    
    return totalSize
  } catch {
    return 0
  }
}

async function cleanupOldestFiles(requiredSpace: number): Promise<void> {
  try {
    const files = await readdir(TTS_CACHE_DIR)
    const fileInfos = []
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      fileInfos.push({ path: filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size })
    }
    
    fileInfos.sort((a, b) => a.mtimeMs - b.mtimeMs)
    
    let freedSpace = 0
    for (const fileInfo of fileInfos) {
      await unlink(fileInfo.path)
      freedSpace += fileInfo.size
      
      if (freedSpace >= requiredSpace) break
    }
    
    logger.info(`TTS cache freed ${freedSpace} bytes by removing old files`)
  } catch (error) {
    logger.error('TTS cache cleanup failed:', error)
  }
}

async function cacheAudio(cacheKey: string, audioData: Buffer): Promise<void> {
  const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
  
  await ensureCacheDir()
  const currentCacheSize = await getCacheSize()
  
  if (currentCacheSize + audioData.length > MAX_CACHE_SIZE_BYTES) {
    await cleanupOldestFiles(audioData.length)
  }
  
  await writeFile(filePath, audioData)
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

export async function getCacheStats(): Promise<{ count: number; sizeBytes: number; sizeMB: number }> {
  try {
    await ensureCacheDir()
    const files = await readdir(TTS_CACHE_DIR)
    let count = 0
    let totalSize = 0
    
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue
      
      const filePath = join(TTS_CACHE_DIR, file)
      const fileStat = await stat(filePath)
      
      if (Date.now() - fileStat.mtimeMs <= CACHE_TTL_MS) {
        count++
        totalSize += fileStat.size
      }
    }
    
    return {
      count,
      sizeBytes: totalSize,
      sizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100
    }
  } catch {
    return { count: 0, sizeBytes: 0, sizeMB: 0 }
  }
}

export { generateCacheKey, ensureCacheDir, getCachedAudio, cacheAudio, getCacheSize, cleanupOldestFiles }

export function createTTSRoutes(db: Database) {
  const app = new Hono()

  app.post('/synthesize', async (c) => {
    const abortController = new AbortController()
    
    c.req.raw.signal.addEventListener('abort', () => {
      logger.info('TTS request aborted by client')
      abortController.abort()
    })
    
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
      
      if (abortController.signal.aborted) {
        return new Response(null, { status: 499 })
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
        signal: abortController.signal,
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
      if (error instanceof Error && error.name === 'AbortError') {
        return new Response(null, { status: 499 })
      }
      logger.error('TTS synthesis failed:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      return c.json({ error: 'TTS synthesis failed' }, 500)
    }
  })

  app.get('/status', async (c) => {
    const userId = c.req.query('userId') || 'default'
    const settingsService = new SettingsService(db)
    const settings = settingsService.getSettings(userId)
    const ttsConfig = settings.preferences.tts
    const cacheStats = await getCacheStats()
    
    return c.json({
      enabled: ttsConfig?.enabled || false,
      configured: !!(ttsConfig?.apiKey),
      cache: {
        ...cacheStats,
        maxSizeMB: MAX_CACHE_SIZE_MB,
        ttlHours: CACHE_TTL_MS / (60 * 60 * 1000)
      }
    })
  })

  return app
}
