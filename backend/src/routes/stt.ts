import { Hono } from 'hono'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { SettingsService } from '../services/settings'
import { logger } from '../utils/logger'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

type STTConfigExtended = {
  enabled: boolean
  provider: 'external' | 'builtin'
  endpoint: string
  apiKey: string
  model: string
  language: string
  continuous: boolean
  availableModels?: string[]
  lastModelsFetch?: number
}

const DISCOVERY_CACHE_DIR = join(getWorkspacePath(), 'cache', 'stt-discovery')
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

function normalizeToBaseUrl(endpoint: string): string {
  return endpoint
    .replace(/\/v1\/audio\/transcriptions$/, '')
    .replace(/\/audio\/transcriptions$/, '')
    .replace(/\/$/, '')
}

async function ensureDiscoveryCacheDir(): Promise<void> {
  await mkdir(DISCOVERY_CACHE_DIR, { recursive: true })
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
    await ensureDiscoveryCacheDir()
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    await writeFile(filePath, JSON.stringify(data))
  } catch (error) {
    logger.error(`Failed to cache STT discovery data for ${cacheKey}:`, error)
  }
}

function generateDiscoveryCacheKey(endpoint: string, apiKey: string, type: 'models'): string {
  const hash = createHash('sha256')
  hash.update(`stt|${endpoint}|${apiKey.substring(0, 8)}|${type}`)
  return hash.digest('hex')
}

async function fetchAvailableModels(endpoint: string, apiKey: string): Promise<string[]> {
  const baseUrl = normalizeToBaseUrl(endpoint)
  const endpointVariations = [
    `${baseUrl}/v1/models`,
    `${baseUrl}/models`,
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

        if ('data' in data && Array.isArray(data.data)) {
          const sttModels = data.data
            .filter((model) => model.id && typeof model.id === 'string')
            .filter((model) =>
              model.id!.toLowerCase().includes('whisper') ||
              model.id!.toLowerCase().includes('transcri')
            )
            .map((model) => model.id!)

          if (sttModels.length > 0) {
            return sttModels
          }
        } else if (Array.isArray(data)) {
          const filtered = data.filter((item): item is string =>
            typeof item === 'string' &&
            (item.toLowerCase().includes('whisper') || item.toLowerCase().includes('transcri'))
          )
          if (filtered.length > 0) {
            return filtered
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to fetch STT models from ${modelEndpoint}:`, error)
      continue
    }
  }

  return ['whisper-1']
}

export function createSTTRoutes(db: Database) {
  const app = new Hono()

  app.post('/transcribe', async (c) => {
    const abortController = new AbortController()

    c.req.raw.signal.addEventListener('abort', () => {
      logger.info('STT request aborted by client')
      abortController.abort()
    })

    try {
      const userId = c.req.query('userId') || 'default'

      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const sttConfig = settings.preferences.stt as STTConfigExtended | undefined

      if (!sttConfig?.enabled) {
        return c.json({ error: 'STT is not enabled' }, 400)
      }

      if (sttConfig.provider !== 'external') {
        return c.json({ error: 'External STT provider is not selected' }, 400)
      }

      if (!sttConfig.apiKey) {
        return c.json({ error: 'STT API key is not configured' }, 400)
      }

      const formData = await c.req.formData()
      const audioFile = formData.get('audio')

      if (!audioFile || !(audioFile instanceof File)) {
        return c.json({ error: 'No audio file provided' }, 400)
      }

      const endpoint = sttConfig.endpoint
      const apiKey = sttConfig.apiKey
      const model = sttConfig.model || 'whisper-1'
      const language = sttConfig.language

      if (abortController.signal.aborted) {
        return new Response(null, { status: 499 })
      }

      logger.info(`STT transcription request: model=${model}, language=${language}, size=${audioFile.size}`)

      const baseUrl = normalizeToBaseUrl(endpoint)
      const transcriptionEndpoint = `${baseUrl}/v1/audio/transcriptions`

      const apiFormData = new FormData()
      apiFormData.append('file', audioFile, audioFile.name || 'audio.webm')
      apiFormData.append('model', model)

      if (language && language !== 'auto') {
        const langCode = language.split('-')[0]
        if (langCode) {
          apiFormData.append('language', langCode)
        }
      }

      const response = await fetch(transcriptionEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: apiFormData,
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`STT API error: ${response.status} - ${errorText}`)
        const status = response.status >= 400 && response.status < 600 ? response.status as 400 | 500 : 500

        let errorDetails = errorText
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.error?.message) {
            errorDetails = errorJson.error.message
          } else if (errorJson.detail?.message) {
            errorDetails = errorJson.detail.message
          } else if (errorJson.message) {
            errorDetails = errorJson.message
          }
        } catch {
          // Use raw error text if parsing fails
        }

        return c.json({
          error: 'STT API request failed',
          details: errorDetails,
        }, status)
      }

      const result = await response.json() as { text: string }
      logger.info(`STT transcription successful: ${result.text.substring(0, 50)}...`)

      return c.json({ text: result.text })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return new Response(null, { status: 499 })
      }
      logger.error('STT transcription failed:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      return c.json({ error: 'STT transcription failed' }, 500)
    }
  })

  app.get('/models', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const forceRefresh = c.req.query('refresh') === 'true'

      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const sttConfig = settings.preferences.stt as STTConfigExtended | undefined

      if (!sttConfig?.apiKey || !sttConfig?.endpoint) {
        return c.json({ error: 'STT not configured' }, 400)
      }

      const cacheKey = generateDiscoveryCacheKey(sttConfig.endpoint, sttConfig.apiKey, 'models')

      if (!forceRefresh) {
        const cachedModels = await getCachedDiscovery(cacheKey)
        if (cachedModels) {
          logger.info(`STT models cache hit for user ${userId}`)
          return c.json({ models: cachedModels, cached: true })
        }
      }

      await ensureDiscoveryCacheDir()
      logger.info(`Fetching STT models for user ${userId}`)

      const models = await fetchAvailableModels(sttConfig.endpoint, sttConfig.apiKey)
      await cacheDiscovery(cacheKey, models)

      await settingsService.updateSettings({
        stt: {
          ...sttConfig,
          availableModels: models,
          lastModelsFetch: Date.now()
        } as STTConfigExtended
      }, userId)

      logger.info(`Fetched ${models.length} STT models`)
      return c.json({ models, cached: false })
    } catch (error) {
      logger.error('Failed to fetch STT models:', error)
      return c.json({ error: 'Failed to fetch models' }, 500)
    }
  })

  app.get('/status', async (c) => {
    const userId = c.req.query('userId') || 'default'
    const settingsService = new SettingsService(db)
    const settings = settingsService.getSettings(userId)
    const sttConfig = settings.preferences.stt as STTConfigExtended | undefined

    return c.json({
      enabled: sttConfig?.enabled || false,
      configured: !!(sttConfig?.apiKey && sttConfig?.endpoint),
      provider: sttConfig?.provider || 'builtin',
      model: sttConfig?.model || 'whisper-1',
    })
  })

  return app
}
