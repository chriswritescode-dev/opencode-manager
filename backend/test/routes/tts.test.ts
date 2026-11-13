import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, truncate, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { TTSConfig } from '@opencode-manager/shared/schemas'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { SettingsService } from '../../src/services/settings'
import {
  cacheAudio,
  cleanupExpiredCache,
  cleanupOldestFiles,
  clearCache,
  createTTSRoutes,
  ensureCacheDir,
  generateCacheKey,
  getCacheSize,
  getCacheStats,
  getCachedAudio,
} from '../../src/routes/tts'
import { createTestDatabase } from '../helpers/test-database'
import { applyTestEnv } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })
const InvalidRequestSchema = z.object({ error: z.string(), details: z.array(z.unknown()) })
const SynthesisErrorSchema = z.object({
  error: z.string(),
  details: z.string(),
  voice: z.string(),
  availableVoices: z.array(z.string()),
})
const ModelsResponseSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })
const VoicesResponseSchema = z.object({ voices: z.array(z.string()), cached: z.boolean() })
const StatusResponseSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  cache: z.object({
    count: z.number(),
    sizeBytes: z.number(),
    sizeMB: z.number(),
    maxSizeMB: z.number(),
    ttlHours: z.number(),
  }),
})
const ClearedResponseSchema = z.object({ cleared: z.number() })

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function createTtsConfig(overrides: Partial<TTSConfig> = {}): TTSConfig {
  return {
    enabled: true,
    provider: 'external',
    autoPlay: false,
    apiKey: 'test-api-key',
    endpoint: 'https://tts.example.com',
    voice: 'alloy',
    model: 'tts-1',
    speed: 1,
    availableVoices: [],
    ...overrides,
  }
}

function jsonResponse(body: JsonValue): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function audioResponse(text: string): Response {
  return new Response(text, { status: 200 })
}

describe('TTS routes', () => {
  let workspace: string
  let restoreEnv: () => void
  let db: Database
  let app: ReturnType<typeof createTTSRoutes>
  let settings: SettingsService
  let cacheDir: string

  function configureTts(config: Partial<TTSConfig> = {}, userId = 'default'): TTSConfig {
    const tts = createTtsConfig(config)
    settings.updateSettings({ tts }, userId)
    return tts
  }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'tts-test-'))
    restoreEnv = applyTestEnv({ WORKSPACE_PATH: workspace })
    cacheDir = join(workspace, 'cache', 'tts')
    db = createTestDatabase()
    settings = new SettingsService(db)
    configureTts()
    app = createTTSRoutes(db)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
    restoreEnv()
    await rm(workspace, { recursive: true, force: true })
  })

  describe('generateCacheKey', () => {
    const params = {
      text: 'Hello world',
      endpoint: 'https://tts.example.com',
      apiKey: 'test-api-key',
      voice: 'alloy',
      model: 'tts-1',
      speed: 1,
    }

    it('generates consistent cache keys for identical inputs', () => {
      const key1 = generateCacheKey(params)
      const key2 = generateCacheKey({ ...params })

      expect(key1).toBe(key2)
      expect(key1).toMatch(/^[a-f0-9]{64}$/)
    })

    it.each([
      ['text', { text: 'Other' }],
      ['voice', { voice: 'echo' }],
      ['model', { model: 'tts-1-hd' }],
      ['speed', { speed: 1.5 }],
      ['api key', { apiKey: 'other-api-key' }],
      ['endpoint', { endpoint: 'https://other.example.com' }],
    ])('generates a different key for a different %s', (_label, override) => {
      expect(generateCacheKey(params)).not.toBe(generateCacheKey({ ...params, ...override }))
    })

    it('normalizes endpoints so trailing slashes share a key', () => {
      expect(generateCacheKey(params)).toBe(generateCacheKey({ ...params, endpoint: 'https://tts.example.com/' }))
    })

    it('avoids delimiter ambiguity between concatenated fields', () => {
      const key1 = generateCacheKey({ ...params, text: 'a', voice: 'b|c' })
      const key2 = generateCacheKey({ ...params, text: 'a|b', voice: 'c' })

      expect(key1).not.toBe(key2)
    })
  })

  describe('clearCache', () => {
    it('deletes every .mp3 file and leaves other files untouched', async () => {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(join(cacheDir, 'a.mp3'), 'a')
      await writeFile(join(cacheDir, 'b.mp3'), 'b')
      await writeFile(join(cacheDir, 'pending.tmp'), 'tmp')
      await writeFile(join(cacheDir, '.a.mp3.ocm-tmp-1-2'), 'atomic')
      await writeFile(join(cacheDir, 'notes.txt'), 'notes')

      const cleared = await clearCache()

      expect(cleared).toBe(2)
      expect(await readdir(cacheDir)).toEqual(expect.arrayContaining(['pending.tmp', '.a.mp3.ocm-tmp-1-2', 'notes.txt']))
      expect(await readdir(cacheDir)).not.toEqual(expect.arrayContaining(['a.mp3']))
    })

    it('tolerates a missing cache directory', async () => {
      await expect(clearCache()).resolves.toBe(0)
    })

    it('throws unexpected filesystem errors', async () => {
      await mkdir(join(cacheDir, 'a.mp3'), { recursive: true })
      await writeFile(join(cacheDir, 'a.mp3', 'child'), 'content')

      await expect(clearCache()).rejects.toThrow()
    })
  })

  describe('ensureCacheDir', () => {
    it('creates the cache directory when it does not exist', async () => {
      await expect(ensureCacheDir()).resolves.toBeUndefined()
      await expect(stat(cacheDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    })
  })

  describe('getCachedAudio', () => {
    it('returns cached audio when the file exists and is not expired', async () => {
      await ensureCacheDir()
      const filePath = join(cacheDir, 'test-key.mp3')
      await writeFile(filePath, 'audio data')

      await expect(getCachedAudio('test-key')).resolves.toEqual(Buffer.from('audio data'))
    })

    it('returns null and removes an expired cached file', async () => {
      await ensureCacheDir()
      const filePath = join(cacheDir, 'test-key.mp3')
      await writeFile(filePath, 'audio data')
      const expired = new Date(Date.now() - CACHE_TTL_MS - 60_000)
      await utimes(filePath, expired, expired)

      await expect(getCachedAudio('test-key')).resolves.toBeNull()
      await expect(stat(filePath)).rejects.toThrow()
    })

    it('returns null when the cached file does not exist', async () => {
      await expect(getCachedAudio('nonexistent-key')).resolves.toBeNull()
    })
  })

  describe('cache sizing and cleanup', () => {
    it('calculates the total size of .mp3 files only', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'file1.mp3'), Buffer.alloc(1024))
      await writeFile(join(cacheDir, 'file2.mp3'), Buffer.alloc(2048))
      await writeFile(join(cacheDir, 'readme.txt'), Buffer.alloc(4096))

      await expect(getCacheSize()).resolves.toBe(3072)
    })

    it('reports zero when the cache directory cannot be read', async () => {
      await mkdir(join(workspace, 'cache'), { recursive: true })
      await writeFile(cacheDir, 'not a directory')

      await expect(getCacheSize()).resolves.toBe(0)
    })

    it('removes the oldest files until the required space is freed', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'file1.mp3'), Buffer.alloc(1024))
      await writeFile(join(cacheDir, 'file2.mp3'), Buffer.alloc(2048))
      await writeFile(join(cacheDir, 'file3.mp3'), Buffer.alloc(1536))
      const oldest = new Date(1000)
      const middle = new Date(2000)
      const newest = new Date(3000)
      await utimes(join(cacheDir, 'file1.mp3'), oldest, oldest)
      await utimes(join(cacheDir, 'file2.mp3'), middle, middle)
      await utimes(join(cacheDir, 'file3.mp3'), newest, newest)

      await cleanupOldestFiles(1500)

      await expect(stat(join(cacheDir, 'file1.mp3'))).rejects.toThrow()
      await expect(stat(join(cacheDir, 'file2.mp3'))).rejects.toThrow()
      await expect(stat(join(cacheDir, 'file3.mp3'))).resolves.toBeDefined()
    })

    it('returns cache statistics for unexpired files', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'file1.mp3'), Buffer.alloc(1024))
      await writeFile(join(cacheDir, 'file2.mp3'), Buffer.alloc(2048))

      const stats = await getCacheStats()

      expect(stats.count).toBe(2)
      expect(stats.sizeBytes).toBe(3072)
      expect(stats.sizeMB).toBeCloseTo(0, 1)
    })

    it('removes only expired cache files', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'file1.mp3'), Buffer.alloc(1024))
      await writeFile(join(cacheDir, 'file2.mp3'), Buffer.alloc(2048))
      await writeFile(join(cacheDir, 'expired.mp3'), Buffer.alloc(1536))
      const expired = new Date(Date.now() - CACHE_TTL_MS - 60_000)
      await utimes(join(cacheDir, 'expired.mp3'), expired, expired)

      await expect(cleanupExpiredCache()).resolves.toBe(1)
      await expect(stat(join(cacheDir, 'expired.mp3'))).rejects.toThrow()
      await expect(stat(join(cacheDir, 'file1.mp3'))).resolves.toBeDefined()
    })
  })

  describe('route handlers', () => {
    it('returns 400 when TTS is not enabled', async () => {
      configureTts({ enabled: false })

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'TTS is not enabled' })
    })

    it('returns 400 when the TTS API key is missing', async () => {
      configureTts({ apiKey: '' })

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'TTS API key is not configured' })
    })

    it('returns 400 for an invalid synthesize body', async () => {
      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      })

      expect(res.status).toBe(400)
      const body = await readJson(res, InvalidRequestSchema)
      expect(body.error).toBe('Invalid request')
      expect(body.details.length).toBeGreaterThan(0)
    })

    it('serves cached audio with a cache hit header', async () => {
      const tts = configureTts()
      const cacheKey = generateCacheKey({ text: 'Hello', ...tts })
      await ensureCacheDir()
      await writeFile(join(cacheDir, `${cacheKey}.mp3`), 'cached')

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Cache')).toBe('HIT')
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('cached')
    })

    it('synthesizes and caches audio on a cache miss', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(audioResponse('fresh-audio'))

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Cache')).toBe('MISS')
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fresh-audio')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://tts.example.com/v1/audio/speech',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
          signal: expect.any(AbortSignal),
        }),
      )

      const tts = createTtsConfig()
      const cacheKey = generateCacheKey({ text: 'Hello', ...tts })
      await expect(readFile(join(cacheDir, `${cacheKey}.mp3`), 'utf-8')).resolves.toBe('fresh-audio')
    })

    it('returns synthesized audio when the cache write fails', async () => {
      await mkdir(join(cacheDir, `${generateCacheKey({ text: 'Hello', ...createTtsConfig() })}.mp3`), { recursive: true })
      await writeFile(join(cacheDir, `${generateCacheKey({ text: 'Hello', ...createTtsConfig() })}.mp3`, 'child'), 'content')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(audioResponse('fresh-audio'))

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Cache')).toBe('MISS')
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fresh-audio')
    })

    it('deduplicates concurrent synthesis requests for the same text', async () => {
      const resolvers: Array<(value: Response) => void> = []
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise((resolve) => {
          resolvers.push(resolve)
        }),
      )

      const request = () => app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      const first = request()
      const second = request()

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

      resolvers[0]!(audioResponse('shared-audio'))

      const [firstRes, secondRes] = await Promise.all([first, second])

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(firstRes.status).toBe(200)
      expect(secondRes.status).toBe(200)
      expect(Buffer.from(await firstRes.arrayBuffer()).toString()).toBe('shared-audio')
      expect(Buffer.from(await secondRes.arrayBuffer()).toString()).toBe('shared-audio')
    })

    it('does not share an in-flight synthesis across different endpoints or API keys', async () => {
      configureTts({ endpoint: 'https://first.example.com', apiKey: 'first-key' }, 'first')
      configureTts({ endpoint: 'https://second.example.com', apiKey: 'second-key' }, 'second')

      const resolvers: Array<(value: Response) => void> = []
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise((resolve) => {
          resolvers.push(resolve)
        }),
      )

      const request = (userId: string) => app.request('/synthesize?userId=' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Isolated text' }),
      })

      const first = request('first')
      const second = request('second')

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

      resolvers[0]!(audioResponse('first-audio'))
      resolvers[1]!(audioResponse('second-audio'))

      const [firstRes, secondRes] = await Promise.all([first, second])

      expect(firstRes.status).toBe(200)
      expect(secondRes.status).toBe(200)
      expect(Buffer.from(await firstRes.arrayBuffer()).toString()).toBe('first-audio')
      expect(Buffer.from(await secondRes.arrayBuffer()).toString()).toBe('second-audio')
    })

    it('isolates the disk cache across providers for identical text', async () => {
      configureTts({ endpoint: 'https://first.example.com', apiKey: 'first-key' }, 'first')
      configureTts({ endpoint: 'https://second.example.com', apiKey: 'second-key' }, 'second')
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => audioResponse('audio'))

      const firstResponse = await app.request('/synthesize?userId=first', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Shared text' }),
      })
      const secondResponse = await app.request('/synthesize?userId=second', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Shared text' }),
      })

      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(200)

      const cachedFiles = (await readdir(cacheDir)).filter((file) => file.endsWith('.mp3'))
      expect(cachedFiles).toHaveLength(2)
      expect(settings.getSettings('second').preferences.tts?.apiKey).toBe('second-key')
    })

    it('returns the upstream error details when synthesis fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ detail: { error: { message: 'Voice not supported' } } }),
        { status: 400 },
      ))

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(400)
      await expect(readJson(res, SynthesisErrorSchema)).resolves.toEqual({
        error: 'TTS API request failed',
        details: 'Voice not supported',
        voice: 'alloy',
        availableVoices: [],
      })
    })

    it('returns an upstream error when synthesis times out', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

      const res = await app.request('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      })

      expect(res.status).toBe(500)
      await expect(readJson(res, SynthesisErrorSchema)).resolves.toEqual({
        error: 'TTS API request failed',
        details: 'TTS upstream request timed out',
        voice: 'alloy',
        availableVoices: [],
      })
    })

    it('lists models and stores them when not cached', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ id: 'tts-1' }, { id: 'tts-1-hd' }] }))

      const res = await app.request('/models')

      expect(res.status).toBe(200)
      await expect(readJson(res, ModelsResponseSchema)).resolves.toEqual({
        models: ['tts-1', 'tts-1-hd'],
        cached: false,
      })
      expect(settings.getSettings().preferences.tts?.availableModels).toEqual(['tts-1', 'tts-1-hd'])
    })

    it('returns 400 when models are requested without configuration', async () => {
      configureTts({ endpoint: '' })

      const res = await app.request('/models')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'TTS not configured' })
    })

    it('lists voices from the OpenAI data response format', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ id: 'alloy' }, { name: 'echo' }] }))

      const res = await app.request('/voices')

      expect(res.status).toBe(200)
      await expect(readJson(res, VoicesResponseSchema)).resolves.toEqual({
        voices: ['alloy', 'echo'],
        cached: false,
      })
      expect(settings.getSettings().preferences.tts?.availableVoices).toEqual(['alloy', 'echo'])
    })

    it('lists voices from the simple array response format', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(['alloy', { voice: 'echo' }]))

      const res = await app.request('/voices')

      expect(res.status).toBe(200)
      await expect(readJson(res, VoicesResponseSchema)).resolves.toEqual({
        voices: ['alloy', 'echo'],
        cached: false,
      })
    })

    it('falls back to the default voices when every endpoint fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

      const res = await app.request('/voices')

      expect(res.status).toBe(200)
      await expect(readJson(res, VoicesResponseSchema)).resolves.toEqual({
        voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
        cached: false,
      })
    })

    it('returns 400 when voices are requested without configuration', async () => {
      configureTts({ endpoint: '' })

      const res = await app.request('/voices')

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'TTS not configured' })
    })

    it('returns the cache status', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'cached.mp3'), Buffer.alloc(1024))

      const res = await app.request('/status')

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual({
        enabled: true,
        configured: true,
        cache: { count: 1, sizeBytes: 1024, sizeMB: 0, maxSizeMB: 200, ttlHours: 24 },
      })
    })

    it('clears the cache through the DELETE /cache route', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'a.mp3'), 'a')
      await writeFile(join(cacheDir, 'b.mp3'), 'b')
      await writeFile(join(cacheDir, 'pending.tmp'), 'tmp')
      await writeFile(join(cacheDir, '.a.mp3.ocm-tmp-1-2'), 'atomic')

      const res = await app.request('/cache', { method: 'DELETE' })

      expect(res.status).toBe(200)
      await expect(readJson(res, ClearedResponseSchema)).resolves.toEqual({ cleared: 2 })
      expect(await readdir(cacheDir)).toEqual(expect.arrayContaining(['pending.tmp', '.a.mp3.ocm-tmp-1-2']))
    })

    it('returns zero when the cache directory is missing', async () => {
      const res = await app.request('/cache', { method: 'DELETE' })

      expect(res.status).toBe(200)
      await expect(readJson(res, ClearedResponseSchema)).resolves.toEqual({ cleared: 0 })
    })

    it('returns 500 when clearing the cache fails unexpectedly', async () => {
      await mkdir(join(cacheDir, 'a.mp3'), { recursive: true })
      await writeFile(join(cacheDir, 'a.mp3', 'child'), 'content')

      const res = await app.request('/cache', { method: 'DELETE' })

      expect(res.status).toBe(500)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Failed to clear TTS cache' })
    })
  })

  describe('cacheAudio', () => {
    it('writes audio and frees space when the cache limit would be exceeded', async () => {
      await ensureCacheDir()
      const bigFile = join(cacheDir, 'big.mp3')
      await writeFile(bigFile, '')
      await truncate(bigFile, 200 * 1024 * 1024)

      await cacheAudio('cache-key', Buffer.from('audio'))

      await expect(stat(bigFile)).rejects.toThrow()
      await expect(readFile(join(cacheDir, 'cache-key.mp3'), 'utf-8')).resolves.toBe('audio')
    })

    it('writes audio without cleanup when the cache has room', async () => {
      await ensureCacheDir()
      await writeFile(join(cacheDir, 'small.mp3'), Buffer.alloc(1024))

      await cacheAudio('cache-key', Buffer.from('audio'))

      await expect(stat(join(cacheDir, 'small.mp3'))).resolves.toBeDefined()
      await expect(readFile(join(cacheDir, 'cache-key.mp3'), 'utf-8')).resolves.toBe('audio')
    })

    it('propagates an atomic write failure', async () => {
      await mkdir(join(workspace, 'cache'), { recursive: true })
      await writeFile(cacheDir, 'not a directory')

      await expect(cacheAudio('cache-key', Buffer.from('audio'))).rejects.toThrow()
    })
  })
})
