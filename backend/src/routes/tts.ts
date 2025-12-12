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

async function cacheAudio(cacheKey: string, audioData: Buffer): Promise<void> {
  const filePath = join(TTS_CACHE_DIR, `${cacheKey}.mp3`)
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
