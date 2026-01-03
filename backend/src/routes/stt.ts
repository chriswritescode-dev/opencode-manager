import { Hono } from 'hono'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { whisperServerManager } from '../services/whisper'
import { logger } from '../utils/logger'

const TranscribeRequestSchema = z.object({
  audio: z.string().min(1),
  format: z.string().optional().default('webm'),
  language: z.string().optional(),
  model: z.string().optional()
})

export function createSTTRoutes(db: Database) {
  const app = new Hono()

  app.post('/transcribe', async (c) => {
    try {
      const body = await c.req.json()
      const { audio, format, language, model } = TranscribeRequestSchema.parse(body)
      const userId = c.req.query('userId') || 'default'

      const settingsService = new SettingsService(db)
      const settings = settingsService.getSettings(userId)
      const sttConfig = settings.preferences.stt

      if (!sttConfig?.enabled) {
        return c.json({ error: 'STT is not enabled' }, 400)
      }

      const status = whisperServerManager.getStatus()
      if (!status.running) {
        return c.json({ error: 'Whisper server is not running' }, 503)
      }

      let audioData: string = audio
      if (audio.includes(',')) {
        audioData = audio.split(',')[1]
      }

      const audioBuffer = Buffer.from(audioData, 'base64')

      const result = await whisperServerManager.transcribe(audioBuffer, {
        model: model || sttConfig.model,
        language: language || sttConfig.language,
        format
      })

      logger.info(`STT transcription completed: ${result.text.substring(0, 50)}...`)

      return c.json({
        text: result.text,
        language: result.language,
        language_probability: result.language_probability,
        duration: result.duration
      })
    } catch (error) {
      logger.error('STT transcription failed:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      return c.json({ 
        error: 'Transcription failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/models', async (c) => {
    try {
      const models = await whisperServerManager.getModels()
      return c.json(models)
    } catch (error) {
      logger.error('Failed to fetch STT models:', error)
      return c.json({ error: 'Failed to fetch models' }, 500)
    }
  })

  app.get('/status', async (c) => {
    const userId = c.req.query('userId') || 'default'
    const settingsService = new SettingsService(db)
    const settings = settingsService.getSettings(userId)
    const sttConfig = settings.preferences.stt
    const serverStatus = whisperServerManager.getStatus()

    return c.json({
      enabled: sttConfig?.enabled || false,
      configured: true,
      server: {
        running: serverStatus.running,
        port: serverStatus.port,
        host: serverStatus.host,
        model: serverStatus.model,
        error: serverStatus.error
      },
      config: {
        model: sttConfig?.model || 'base',
        language: sttConfig?.language || 'auto',
        autoSubmit: sttConfig?.autoSubmit || false
      }
    })
  })

  return app
}
