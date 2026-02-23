import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { ApiEmbeddingProvider } from '../src/embedding/api'
import { LocalEmbeddingProvider } from '../src/embedding/local'
import { SharedEmbeddingClient } from '../src/embedding/client'
import { createEmbeddingProvider, createEmbeddingService } from '../src/embedding'
import type { EmbeddingProvider } from '../src/embedding'
import type { EmbeddingConfig } from '../src/types'

describe('ApiEmbeddingProvider', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('API provider batching — 150 texts should make 2 batches (100 + 50)', async () => {
    let callCount = 0
    global.fetch = async (): Promise<Response> => {
      callCount++
      return new Response(
        JSON.stringify({
          data: Array.from({ length: callCount === 1 ? 100 : 50 }, (_, i) => ({
            embedding: Array(1536).fill(0.1 * (callCount === 1 ? i : i + 100)),
          })),
        }),
        { status: 200 }
      )
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small')
    const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`)

    const results = await provider.embed(texts)

    expect(callCount).toBe(2)
    expect(results.length).toBe(150)
  })

  test('API provider error handling — non-200 response throws', async () => {
    global.fetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', undefined, undefined, 'invalid-key')

    await expect(provider.embed(['test'])).rejects.toThrow('Embedding API error: 401')
  })

  test('API provider endpoint normalization — various base URL formats', () => {
    const testCases = [
      { input: 'https://api.openai.com/v1/embeddings', expected: 'https://api.openai.com/v1/embeddings' },
      { input: 'https://api.openai.com/v1/', expected: 'https://api.openai.com/v1/embeddings' },
      { input: 'https://api.openai.com', expected: 'https://api.openai.com/v1/embeddings' },
      { input: 'https://api.openai.com/', expected: 'https://api.openai.com/v1/embeddings' },
    ]

    for (const { input, expected } of testCases) {
      const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', input)
      expect(provider['endpoint']).toBe(expected)
    }
  })

  test('API provider uses correct default model and dimensions for known models', () => {
    const openaiProvider = new ApiEmbeddingProvider('openai')
    expect(openaiProvider.dimensions).toBe(1536)
    expect(openaiProvider['model']).toBe('text-embedding-3-small')

    const voyageProvider = new ApiEmbeddingProvider('voyage', 'voyage-code-3')
    expect(voyageProvider.dimensions).toBe(1024)
    expect(voyageProvider['model']).toBe('voyage-code-3')
  })

  test('API provider uses explicit dimensions when provided', () => {
    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', undefined, 2048)
    expect(provider.dimensions).toBe(2048)
  })

  test('API provider test returns false on error', async () => {
    global.fetch = async (): Promise<Response> => {
      return new Response('Internal Server Error', { status: 500 })
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small')
    const result = await provider.test()

    expect(result).toBe(false)
  })
})

describe('LocalEmbeddingProvider', () => {
  test('Local provider dimensions — verify correct dimensions for known models', () => {
    const miniLMProvider = new LocalEmbeddingProvider('all-MiniLM-L6-v2')
    expect(miniLMProvider.dimensions).toBe(384)
    expect(miniLMProvider.name).toBe('local:384d')

    const unknownProvider = new LocalEmbeddingProvider('unknown-model')
    expect(unknownProvider.dimensions).toBe(384)
    expect(unknownProvider.name).toBe('local:384d')
  })

  test('Local provider defaults to all-MiniLM-L6-v2 for unknown model', () => {
    const provider = new LocalEmbeddingProvider('unknown-model')
    expect(provider.dimensions).toBe(384)
    expect(provider.name).toBe('local:384d')
  })
})

describe('createEmbeddingProvider', () => {
  test('Provider factory — correct provider type created for each config', () => {
    const openaiConfig: EmbeddingConfig = {
      provider: 'openai',
      model: 'text-embedding-3-small',
    }

    const voyageConfig: EmbeddingConfig = {
      provider: 'voyage',
      model: 'voyage-2',
    }

    const localConfig: EmbeddingConfig = {
      provider: 'local',
      model: 'all-MiniLM-L6-v2',
    }

    const openaiProvider = createEmbeddingProvider(openaiConfig)
    expect(openaiProvider).toBeInstanceOf(ApiEmbeddingProvider)
    expect(openaiProvider.dimensions).toBe(1536)

    const voyageProvider = createEmbeddingProvider(voyageConfig)
    expect(voyageProvider).toBeInstanceOf(ApiEmbeddingProvider)
    expect(voyageProvider.dimensions).toBe(1536)

    const localProvider = createEmbeddingProvider(localConfig)
    expect(localProvider).toBeInstanceOf(SharedEmbeddingClient)
    expect(localProvider.dimensions).toBe(384)
  })

  test('Provider factory uses custom dimensions when provided', () => {
    const config: EmbeddingConfig = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 2048,
    }

    const provider = createEmbeddingProvider(config)
    expect(provider.dimensions).toBe(2048)
  })

  test('Provider factory uses custom baseUrl when provided', () => {
    const config: EmbeddingConfig = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      baseUrl: 'https://custom.api.com/v1',
    }

    const provider = createEmbeddingProvider(config)
    expect(provider['endpoint' as keyof EmbeddingProvider]).toBe('https://custom.api.com/v1/embeddings')
  })
})

describe('createEmbeddingService', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('Embedding service caches results', async () => {
    let callCount = 0

    global.fetch = async (): Promise<Response> => {
      callCount++
      return new Response(
        JSON.stringify({
          data: Array.from({ length: 1 }, () => ({
            embedding: Array(1536).fill(0.1),
          })),
        }),
        { status: 200 }
      )
    }

    const cacheStore = new Map<string, unknown>()
    let cacheHit = false

    const mockCache = {
      async get<T>(key: string): Promise<T | null> {
        if (cacheStore.has(key)) {
          cacheHit = true
          return cacheStore.get(key) as T
        }
        return null
      },
      async set<T>(key: string, value: T, _ttlSeconds?: number): Promise<void> {
        cacheStore.set(key, value)
      },
      async del(_key: string): Promise<void> {},
      async invalidatePattern(_pattern: string): Promise<void> {},
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', undefined, undefined, 'test-key')
    const service = createEmbeddingService(provider, mockCache)

    await service.embedText('test text')
    await service.embedText('test text')

    expect(cacheHit).toBe(true)
    expect(callCount).toBe(1)
  })

  test('Embedding service caches miss calls API', async () => {
    let callCount = 0

    global.fetch = async (): Promise<Response> => {
      callCount++
      return new Response(
        JSON.stringify({
          data: [{ embedding: Array(1536).fill(0.1) }],
        }),
        { status: 200 }
      )
    }

    const cacheStore = new Map<string, unknown>()
    const mockCache = {
      async get<T>(key: string): Promise<T | null> {
        return cacheStore.get(key) as T | null
      },
      async set<T>(key: string, value: T, _ttlSeconds?: number): Promise<void> {
        cacheStore.set(key, value)
      },
      async del(_key: string): Promise<void> {},
      async invalidatePattern(_pattern: string): Promise<void> {},
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', undefined, undefined, 'test-key')
    const service = createEmbeddingService(provider, mockCache)

    await service.embedText('unique text 1')
    await service.embedText('unique text 2')

    expect(callCount).toBe(2)
  })

  test('embedTexts batches multiple texts', async () => {
    let callCount = 0
    const batchTexts: string[][] = []

    global.fetch = async (input: global.RequestInfo | URL, init?: global.RequestInit): Promise<Response> => {
      callCount++
      const body = init?.body ? JSON.parse(init.body as string) : { input: [] }
      batchTexts.push(body.input)
      return new Response(
        JSON.stringify({
          data: body.input.map((_: string, i: number) => ({
            embedding: Array(1536).fill(0.1 * i),
          })),
        }),
        { status: 200 }
      )
    }

    const mockCache = {
      async get<T>(_key: string): Promise<T | null> {
        return null
      },
      async set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {},
      async del(_key: string): Promise<void> {},
      async invalidatePattern(_pattern: string): Promise<void> {},
    }

    const provider = new ApiEmbeddingProvider('openai', 'text-embedding-3-small', undefined, undefined, 'test-key')
    const service = createEmbeddingService(provider, mockCache)

    const texts = Array.from({ length: 50 }, (_, i) => `text ${i}`)
    const results = await service.embedTexts(texts)

    expect(callCount).toBe(1)
    expect(results).toHaveLength(50)
  })
})
