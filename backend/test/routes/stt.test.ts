import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs/promises'

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  })),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: () => '/test/workspace',
  ENV: {
    WORKSPACE: {
      BASE_PATH: '/test/workspace',
    },
  },
}))

const mockMkdir = fs.mkdir as any
const mockReadFile = fs.readFile as any
const mockWriteFile = fs.writeFile as any
const mockStat = fs.stat as any
const mockUnlink = fs.unlink as any

import { createSTTRoutes } from '../../src/routes/stt'

describe('STT Routes', () => {
  let mockDb: any
  let sttApp: ReturnType<typeof createSTTRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    
    mockGetSettings.mockReturnValue({
      preferences: {
        stt: {
          enabled: true,
          provider: 'external',
          apiKey: 'test-api-key',
          endpoint: 'https://api.openai.com',
          model: 'whisper-1',
          language: 'en-US',
          continuous: false,
        },
      },
    })
    
    sttApp = createSTTRoutes(mockDb)
  })

  describe('createSTTRoutes', () => {
    it('should create a Hono app with routes', () => {
      expect(sttApp).toBeDefined()
      expect(typeof sttApp.fetch).toBe('function')
    })
  })

  describe('GET /status', () => {
    it('should return status with correct structure', async () => {
      const req = new Request('http://localhost/status?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toHaveProperty('enabled')
      expect(json).toHaveProperty('configured')
      expect(json).toHaveProperty('provider')
      expect(json).toHaveProperty('model')
    })

    it('should return enabled true when STT is enabled', async () => {
      const req = new Request('http://localhost/status?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(json.enabled).toBe(true)
      expect(json.configured).toBe(true)
      expect(json.provider).toBe('external')
      expect(json.model).toBe('whisper-1')
    })

    it('should return enabled false when STT is disabled', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: false,
            provider: 'builtin',
            apiKey: '',
            endpoint: '',
            model: '',
            language: 'en-US',
          },
        },
      })

      const req = new Request('http://localhost/status?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(json.enabled).toBe(false)
      expect(json.configured).toBe(false)
    })

    it('should handle missing STT config gracefully', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {},
      })

      const req = new Request('http://localhost/status?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.enabled).toBe(false)
      expect(json.provider).toBe('builtin')
    })
  })

  describe('POST /transcribe', () => {
    it('should reject when STT is disabled', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: false,
            provider: 'external',
            apiKey: 'test-key',
            endpoint: 'https://api.openai.com',
            model: 'whisper-1',
          },
        },
      })

      const audioBlob = new Blob(['fake audio'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'test.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('STT is not enabled')
    })

    it('should reject when provider is builtin', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'builtin',
            apiKey: 'test-key',
            endpoint: 'https://api.openai.com',
            model: 'whisper-1',
          },
        },
      })

      const audioBlob = new Blob(['fake audio'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'test.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('External STT provider is not selected')
    })

    it('should reject when API key is missing', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'external',
            apiKey: '',
            endpoint: 'https://api.openai.com',
            model: 'whisper-1',
          },
        },
      })

      const audioBlob = new Blob(['fake audio'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'test.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('STT API key is not configured')
    })

    it('should reject when endpoint is missing', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'external',
            apiKey: 'test-key',
            endpoint: '',
            model: 'whisper-1',
          },
        },
      })

      const audioBlob = new Blob(['fake audio'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'test.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('STT endpoint is not configured')
    })

    it('should reject when no audio file provided', async () => {
      const formData = new FormData()

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('No audio file provided')
    })

    it('should successfully transcribe when API returns success', async () => {
      const originalFetch = globalThis.fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Hello, world!' }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })

      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.text).toBe('Hello, world!')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-key',
          },
        })
      )

      globalThis.fetch = originalFetch
    })

    it('should handle API errors gracefully', async () => {
      const originalFetch = globalThis.fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })

      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(401)
      expect(json.error).toBe('STT API request failed')
      expect(json.details).toBe('Invalid API key')

      globalThis.fetch = originalFetch
    })
  })

  describe('GET /models', () => {
    it('should reject when STT not configured', async () => {
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'external',
            apiKey: '',
            endpoint: '',
            model: '',
          },
        },
      })

      const req = new Request('http://localhost/models?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('STT not configured')
    })

    it('should return cached models when available', async () => {
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 1000,
      })
      mockReadFile.mockResolvedValue(JSON.stringify(['whisper-1', 'whisper-large']))

      const req = new Request('http://localhost/models?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.models).toEqual(['whisper-1', 'whisper-large'])
      expect(json.cached).toBe(true)
    })

    it('should fetch models from API when cache is expired', async () => {
      const originalFetch = globalThis.fetch
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 2 * 60 * 60 * 1000,
      })
      mockUnlink.mockResolvedValue(undefined)
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'whisper-1' },
            { id: 'gpt-4' },
            { id: 'whisper-large-v3' },
          ],
        }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const req = new Request('http://localhost/models?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.models).toEqual(['whisper-1', 'whisper-large-v3'])
      expect(json.cached).toBe(false)

      globalThis.fetch = originalFetch
    })

    it('should return default model when API fetch fails', async () => {
      const originalFetch = globalThis.fetch
      mockStat.mockRejectedValue(new Error('File not found'))
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const req = new Request('http://localhost/models?userId=test')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.models).toEqual(['whisper-1'])

      globalThis.fetch = originalFetch
    })

    it('should force refresh when refresh=true', async () => {
      const originalFetch = globalThis.fetch
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'whisper-1' }],
        }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const req = new Request('http://localhost/models?userId=test&refresh=true')
      const res = await sttApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.cached).toBe(false)
      expect(mockFetch).toHaveBeenCalled()

      globalThis.fetch = originalFetch
    })
  })

  describe('URL normalization', () => {
    it('should normalize endpoint with trailing path', async () => {
      const originalFetch = globalThis.fetch
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'external',
            apiKey: 'test-api-key',
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            language: 'en-US',
          },
        },
      })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Test' }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })

      await sttApp.fetch(req)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.anything()
      )

      globalThis.fetch = originalFetch
    })

    it('should handle endpoint with trailing slash', async () => {
      const originalFetch = globalThis.fetch
      mockGetSettings.mockReturnValue({
        preferences: {
          stt: {
            enabled: true,
            provider: 'external',
            apiKey: 'test-api-key',
            endpoint: 'https://api.openai.com/',
            model: 'whisper-1',
            language: 'en-US',
          },
        },
      })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Test' }),
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')

      const req = new Request('http://localhost/transcribe?userId=test', {
        method: 'POST',
        body: formData,
      })

      await sttApp.fetch(req)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.anything()
      )

      globalThis.fetch = originalFetch
    })
  })
})
