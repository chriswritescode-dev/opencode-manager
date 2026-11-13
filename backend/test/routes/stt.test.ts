import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir, stat, utimes } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { STTConfig } from '@opencode-manager/shared/schemas'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { createSTTRoutes } from '../../src/routes/stt'
import { SettingsService } from '../../src/services/settings'
import { readJson } from '../helpers/read-json'
import { createTestDatabase } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

const StatusResponseSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  provider: z.string(),
  model: z.string(),
})
const TranscriptionResponseSchema = z.object({ text: z.string() })
const ErrorResponseSchema = z.object({ error: z.string() })
const ErrorDetailsResponseSchema = z.object({ error: z.string(), details: z.string() })
const ModelsResponseSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })

const TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000

function createSttConfig(overrides: Partial<STTConfig> = {}): STTConfig {
  return {
    enabled: true,
    provider: 'external',
    apiKey: 'test-api-key',
    endpoint: 'https://api.openai.com',
    model: 'whisper-1',
    language: 'en-US',
    ...overrides,
  }
}

function audioFormData(): FormData {
  const formData = new FormData()
  formData.append('audio', new File(['fake audio data'], 'audio.webm', { type: 'audio/webm' }))
  return formData
}

function transcribeRequest(app: ReturnType<typeof createSTTRoutes>, formData?: FormData): Promise<Response> {
  return Promise.resolve(app.request('/transcribe?userId=test', {
    method: 'POST',
    body: formData ?? audioFormData(),
  }))
}

function jsonResponse(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('STT routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let settings: SettingsService
  let app: ReturnType<typeof createSTTRoutes>

  function configureStt(overrides: Partial<STTConfig> = {}): STTConfig {
    const stt = createSttConfig(overrides)
    settings.updateSettings({ stt }, 'test')
    return stt
  }

  beforeEach(() => {
    workspace = createTempWorkspace('stt-test-')
    db = createTestDatabase()
    settings = new SettingsService(db)
    app = createSTTRoutes(db)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    workspace.restore()
  })

  describe('GET /status', () => {
    it.each([
      [
        'a configured external provider',
        { enabled: true, provider: 'external' },
        { enabled: true, configured: true, provider: 'external', model: 'whisper-1' },
      ],
      [
        'a disabled builtin provider',
        { enabled: false, provider: 'builtin' },
        { enabled: false, configured: true, provider: 'builtin', model: 'whisper-1' },
      ],
    ] as const)('reports %s', async (_label, overrides, expected) => {
      configureStt(overrides)

      const res = await app.request('/status?userId=test')

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual(expected)
    })

    it('uses the default STT preferences when the user has none stored', async () => {
      const res = await app.request('/status?userId=test')

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual({
        enabled: false,
        configured: true,
        provider: 'builtin',
        model: 'whisper-1',
      })
    })
  })

  describe('POST /transcribe', () => {
    it.each([
      ['STT is disabled', { enabled: false }, 'STT is not enabled'],
      ['the provider is builtin', { provider: 'builtin' }, 'External STT provider is not selected'],
      ['the endpoint is missing', { endpoint: '' }, 'STT endpoint is not configured'],
    ] as const)('rejects when %s', async (_label, overrides, expectedError) => {
      configureStt(overrides)

      const res = await transcribeRequest(app)

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: expectedError })
    })

    it('rejects when no audio file is uploaded', async () => {
      configureStt()

      const res = await transcribeRequest(app, new FormData())

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'No audio file provided' })
    })

    it('transcribes audio through the configured provider', async () => {
      configureStt()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ text: 'Hello, world!' }))

      const res = await transcribeRequest(app)

      expect(res.status).toBe(200)
      await expect(readJson(res, TranscriptionResponseSchema)).resolves.toEqual({ text: 'Hello, world!' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe(TRANSCRIPTION_URL)
      const init = fetchMock.mock.calls[0]?.[1]
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-api-key')
      expect(init?.body).toBeInstanceOf(FormData)
      const body = init?.body
      if (!(body instanceof FormData)) throw new Error('expected a multipart body')
      expect(body.get('model')).toBe('whisper-1')
      expect(body.get('language')).toBe('en')
    })

    it('omits the Authorization header when no API key is configured', async () => {
      configureStt({ apiKey: '' })
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ text: 'Hello, world!' }))

      const res = await transcribeRequest(app)

      expect(res.status).toBe(200)
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
    })

    it('maps an upstream failure to the same status and reports its message', async () => {
      configureStt()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
        JSON.stringify({ error: { message: 'Invalid API key' } }),
        { status: 401 },
      ))

      const res = await transcribeRequest(app)

      expect(res.status).toBe(401)
      await expect(readJson(res, ErrorDetailsResponseSchema)).resolves.toEqual({
        error: 'STT API request failed',
        details: 'Invalid API key',
      })
    })

    it('returns 500 when the upstream response has no text', async () => {
      configureStt()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ error: 'some error' }))

      const res = await transcribeRequest(app)

      expect(res.status).toBe(500)
      const body = await readJson(res, ErrorDetailsResponseSchema)
      expect(body.error).toBe('STT API returned invalid response')
      expect(body.details).toContain('Response missing text field')
    })

    it.each([
      'https://api.openai.com',
      'https://api.openai.com/',
      'https://api.openai.com/v1',
      'https://api.openai.com/v1/audio/transcriptions',
    ])('normalizes the configured endpoint %s to the transcription path', async (endpoint) => {
      configureStt({ endpoint })
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ text: 'Test' }))

      await transcribeRequest(app)

      expect(fetchMock.mock.calls[0]?.[0]).toBe(TRANSCRIPTION_URL)
    })
  })

  describe('GET /models', () => {
    it('returns 400 when the endpoint is not configured', async () => {
      configureStt({ endpoint: '' })

      const res = await app.request('/models?userId=test')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'STT not configured' })
    })

    it('discovers whisper models from the provider and caches them', async () => {
      configureStt()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
        data: [{ id: 'whisper-1' }, { id: 'gpt-4' }, { id: 'whisper-large-v3' }],
      }))

      const res = await app.request('/models?userId=test')

      expect(res.status).toBe(200)
      await expect(readJson(res, ModelsResponseSchema)).resolves.toEqual({
        models: ['whisper-1', 'whisper-large-v3'],
        cached: false,
      })
      expect(settings.getSettings('test').preferences.stt?.availableModels).toEqual(['whisper-1', 'whisper-large-v3'])

      const cachedRes = await app.request('/models?userId=test')

      await expect(readJson(cachedRes, ModelsResponseSchema)).resolves.toEqual({
        models: ['whisper-1', 'whisper-large-v3'],
        cached: true,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refreshes an expired model cache', async () => {
      configureStt()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: [{ id: 'whisper-1' }] }))
      await app.request('/models?userId=test')

      const cacheDir = join(workspace.path, 'cache', 'discovery')
      const cacheFile = (await readdir(cacheDir))[0]
      if (cacheFile === undefined) throw new Error('expected a cached model file')
      const expired = new Date(Date.now() - MODEL_CACHE_TTL_MS - 60_000)
      await utimes(join(cacheDir, cacheFile), expired, expired)

      const res = await app.request('/models?userId=test')

      await expect(readJson(res, ModelsResponseSchema)).resolves.toEqual({ models: ['whisper-1'], cached: false })
      await expect(stat(join(cacheDir, cacheFile))).resolves.toBeDefined()
    })

    it('refetches when refresh is requested even with a fresh cache', async () => {
      configureStt()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: [{ id: 'whisper-1' }] }))
      await app.request('/models?userId=test')

      const res = await app.request('/models?userId=test&refresh=true')

      await expect(readJson(res, ModelsResponseSchema)).resolves.toEqual({ models: ['whisper-1'], cached: false })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('falls back to the default model when the provider cannot be reached', async () => {
      configureStt()
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

      const res = await app.request('/models?userId=test')

      expect(res.status).toBe(200)
      await expect(readJson(res, ModelsResponseSchema)).resolves.toEqual({ models: ['whisper-1'], cached: false })
    })
  })
})
