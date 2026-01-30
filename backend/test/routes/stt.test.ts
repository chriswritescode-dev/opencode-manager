import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockWhisperManager = vi.hoisted(() => ({
  syncStatus: vi.fn(),
  transcribe: vi.fn(),
  getModels: vi.fn(),
  getStatus: vi.fn(),
  getPort: vi.fn(),
  getHost: vi.fn(),
  getBaseUrl: vi.fn()
}))

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('../../src/utils/logger', async () => {
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockReturnValue({
      preferences: {
        stt: {
          enabled: true,
          model: 'base',
          language: 'auto',
          autoSubmit: false
        }
      }
    })
  }))
}))

vi.mock('../../src/services/whisper', () => ({
  whisperServerManager: mockWhisperManager
}))

import { createSTTRoutes } from '../../src/routes/stt'
import { SettingsService } from '../../src/services/settings'

describe('STT Routes', () => {
  let mockDb: any
  let sttApp: ReturnType<typeof createSTTRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    
    mockWhisperManager.syncStatus.mockResolvedValue({
      running: true,
      port: 5552,
      host: '127.0.0.1',
      model: 'base',
      error: null
    })
    mockWhisperManager.transcribe.mockResolvedValue({
      text: 'Hello world',
      language: 'en',
      language_probability: 0.98,
      duration: 2.5
    })
    mockWhisperManager.getModels.mockResolvedValue({
      models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
      current: 'base',
      default: 'base'
    })
    mockWhisperManager.getStatus.mockReturnValue({
      running: true,
      port: 5552,
      host: '127.0.0.1',
      model: 'base',
      error: null
    })
    mockWhisperManager.getPort.mockReturnValue(5552)
    mockWhisperManager.getHost.mockReturnValue('127.0.0.1')
    mockWhisperManager.getBaseUrl.mockReturnValue('http://127.0.0.1:5552')
    
    sttApp = createSTTRoutes(mockDb)
  })

  describe('GET /status', () => {
    it('should return STT status with server running', async () => {
      const res = await sttApp.request('/status')
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.enabled).toBe(true)
      expect(data.configured).toBe(true)
      expect(data.server.running).toBe(true)
      expect(data.server.port).toBe(5552)
      expect(data.server.model).toBe('base')
      expect(data.config.model).toBe('base')
      expect(data.config.language).toBe('auto')
    })

    it('should return server not running status', async () => {
      mockWhisperManager.syncStatus.mockResolvedValueOnce({
        running: false,
        port: 5552,
        host: '127.0.0.1',
        model: null,
        error: 'Connection refused'
      })

      const res = await sttApp.request('/status')
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.server.running).toBe(false)
      expect(data.server.error).toBe('Connection refused')
    })

    it('should return STT disabled when settings say so', async () => {
      const MockSettingsService = SettingsService as unknown as ReturnType<typeof vi.fn>
      MockSettingsService.mockImplementationOnce(() => ({
        getSettings: vi.fn().mockReturnValue({
          preferences: {
            stt: {
              enabled: false,
              model: 'base',
              language: 'auto'
            }
          }
        })
      }))

      const disabledApp = createSTTRoutes(mockDb)
      const res = await disabledApp.request('/status')
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.enabled).toBe(false)
    })
  })

  describe('GET /models', () => {
    it('should return available Whisper models', async () => {
      const res = await sttApp.request('/models')
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.models).toContain('tiny')
      expect(data.models).toContain('base')
      expect(data.models).toContain('small')
      expect(data.models).toContain('medium')
      expect(data.models).toContain('large-v2')
      expect(data.models).toContain('large-v3')
      expect(data.current).toBe('base')
      expect(data.default).toBe('base')
    })

    it('should handle model fetch errors gracefully', async () => {
      mockWhisperManager.getModels.mockRejectedValueOnce(new Error('Server error'))

      const res = await sttApp.request('/models')
      const data = await res.json()

      expect(res.status).toBe(500)
      expect(data.error).toBe('Failed to fetch models')
    })
  })

  describe('POST /transcribe', () => {
    const validBase64Audio = Buffer.from('fake audio data').toString('base64')

    it('should transcribe audio successfully', async () => {
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio,
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.text).toBe('Hello world')
      expect(data.language).toBe('en')
      expect(data.language_probability).toBe(0.98)
      expect(data.duration).toBe(2.5)
    })

    it('should handle data URL format audio', async () => {
      const dataUrl = `data:audio/webm;base64,${validBase64Audio}`
      
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: dataUrl,
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.text).toBe('Hello world')
    })

    it('should reject when STT is disabled', async () => {
      const MockSettingsService = SettingsService as unknown as ReturnType<typeof vi.fn>
      MockSettingsService.mockImplementationOnce(() => ({
        getSettings: vi.fn().mockReturnValue({
          preferences: {
            stt: {
              enabled: false,
              model: 'base',
              language: 'auto'
            }
          }
        })
      }))

      const disabledApp = createSTTRoutes(mockDb)
      const res = await disabledApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio,
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toBe('STT is not enabled')
    })

    it('should reject when Whisper server is not running', async () => {
      mockWhisperManager.syncStatus.mockResolvedValueOnce({
        running: false,
        port: 5552,
        host: '127.0.0.1',
        model: null,
        error: 'Not running'
      })

      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio,
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(503)
      expect(data.error).toBe('Whisper server is not running')
    })

    it('should reject empty audio data', async () => {
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: '',
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toBe('Invalid request')
    })

    it('should reject invalid JSON body', async () => {
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      })
      const data = await res.json()

      expect(res.status).toBe(500)
      expect(data.error).toBe('Transcription failed')
    })

    it('should use custom model and language from request', async () => {
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio,
          format: 'webm',
          model: 'small',
          language: 'en'
        })
      })

      expect(res.status).toBe(200)
      expect(mockWhisperManager.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          model: 'small',
          language: 'en',
          format: 'webm'
        })
      )
    })

    it('should handle transcription errors', async () => {
      mockWhisperManager.transcribe.mockRejectedValueOnce(new Error('Transcription failed'))

      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio,
          format: 'webm'
        })
      })
      const data = await res.json()

      expect(res.status).toBe(500)
      expect(data.error).toBe('Transcription failed')
      expect(data.details).toBe('Transcription failed')
    })

    it('should use settings defaults when model/language not specified', async () => {
      const res = await sttApp.request('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: validBase64Audio
        })
      })

      expect(res.status).toBe(200)
      expect(mockWhisperManager.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          model: 'base',
          language: 'auto'
        })
      )
    })
  })
})
