import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { logger } from '../utils/logger'
import {
  normalizeToBaseUrl,
  ensureDiscoveryCacheDir,
  getCachedDiscovery,
  cacheDiscovery,
  generateDiscoveryCacheKey,
  fetchAvailableModels,
} from '../utils/discovery-cache'
import { type STTConfig } from '@opencode-manager/shared'

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
      const sttConfig = settings.preferences.stt as STTConfig | undefined

      if (!sttConfig?.enabled) {
        return c.json({ error: 'STT is not enabled' }, 400)
      }

      if (sttConfig.provider !== 'external') {
        return c.json({ error: 'External STT provider is not selected' }, 400)
      }

      if (!sttConfig.endpoint) {
        return c.json({ error: 'STT endpoint is not configured' }, 400)
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

      logger.info(`STT transcription request: model=${model}, language=${language}, size=${audioFile.size}, type=${audioFile.type}`)

      const baseUrl = normalizeToBaseUrl(endpoint)
      const transcriptionEndpoint = `${baseUrl}/v1/audio/transcriptions`

      const apiFormData = new FormData()
      apiFormData.append('file', audioFile, audioFile.name || 'audio.wav')
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
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
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

      const result = await response.json() as { text?: string } & Record<string, unknown>

      if (!result.text || typeof result.text !== 'string') {
        logger.error('STT API response missing text field:', { result })
        return c.json({ 
          error: 'STT API returned invalid response', 
          details: `Response missing text field. Full response: ${JSON.stringify(result)}` 
        }, 500)
      }

      logger.info(`STT transcription successful: ${result.text.substring(0, 50)}...`)
      return c.json({ text: result.text })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return new Response(null, { status: 499 })
      }
      logger.error('STT transcription failed:', error)
      return c.json({ error: 'STT transcription failed' }, 500)
    }
  })

  app.get('/models', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const forceRefresh = c.req.query('refresh') === 'true'

      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const sttConfig = settings.preferences.stt as STTConfig | undefined

      if (!sttConfig?.endpoint) {
        return c.json({ error: 'STT not configured' }, 400)
      }

      const cacheKey = generateDiscoveryCacheKey(sttConfig.endpoint, sttConfig.apiKey, 'models')

      if (!forceRefresh) {
        const cachedModels = await getCachedDiscovery<string[]>(cacheKey)
        if (cachedModels) {
          logger.info(`STT models cache hit for user ${userId}`)
          return c.json({ models: cachedModels, cached: true })
        }
      }

      await ensureDiscoveryCacheDir()
      logger.info(`Fetching STT models for user ${userId}`)

      const models = await fetchAvailableModels(
        sttConfig.endpoint,
        sttConfig.apiKey,
        /whisper|transcri/,
        ['whisper-1'],
      )
      await cacheDiscovery(cacheKey, models)

      await settingsService.updateSettings({
        stt: {
          ...sttConfig,
          availableModels: models,
          lastModelsFetch: Date.now()
        } as STTConfig
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
    const sttConfig = settings.preferences.stt as STTConfig | undefined

    return c.json({
      enabled: sttConfig?.enabled || false,
      configured: !!sttConfig?.endpoint,
      provider: sttConfig?.provider || 'builtin',
      model: sttConfig?.model || 'whisper-1',
    })
  })

  return app
}
