import { createHash } from 'crypto'
import type { EmbeddingProvider } from './types'
import type { EmbeddingConfig } from '../types'
import { ApiEmbeddingProvider } from './api'
import { LocalEmbeddingProvider } from './local'
import { SharedEmbeddingClient } from './client'
import { resolveDataDir } from '../storage/database'
import type { CacheService } from '../cache/types'
export { checkServerHealth, isServerRunning, killEmbeddingServer } from './shared'

export type { EmbeddingProvider } from './types'

function getLocalModelDimensions(model: string): number {
  const dimensions: Record<string, number> = {
    'all-MiniLM-L6-v2': 384,
  }
  return dimensions[model] ?? 384
}

function buildProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new ApiEmbeddingProvider('openai', config.model, config.baseUrl, config.dimensions, config.apiKey)
    case 'voyage':
      return new ApiEmbeddingProvider('voyage', config.model, config.baseUrl, config.dimensions, config.apiKey)
    case 'local': {
        const dataDir = config.dataDir ?? resolveDataDir()
        const dimensions = config.dimensions ?? getLocalModelDimensions(config.model)
        
        return new SharedEmbeddingClient({
          dataDir,
          model: config.model,
          dimensions,
          gracePeriod: config.serverGracePeriod,
        })
      }
    default:
      return new ApiEmbeddingProvider('openai', config.model, config.baseUrl, config.dimensions, config.apiKey)
  }
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  return buildProvider(config)
}

export interface EmbeddingService {
  embedText(text: string): Promise<number[]>
  embedTexts(texts: string[]): Promise<number[][]>
}

export function createEmbeddingService(provider: EmbeddingProvider, cache: CacheService): EmbeddingService {
  async function embedText(text: string): Promise<number[]> {
    const results = await embedTexts([text])
    return results[0] ?? new Array(provider.dimensions).fill(0)
  }

  async function embedTexts(texts: string[]): Promise<number[][]> {
    const results: (number[] | undefined)[] = new Array(texts.length).fill(undefined)
    const uncached: Array<{ index: number; text: string; hash: string }> = []

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] ?? ''
      const hash = createHash('sha256').update(text).digest('hex')
      const cacheKey = `emb:${hash}`

      const cached = await cache.get<number[]>(cacheKey)
      if (cached) {
        results[i] = cached
      } else {
        uncached.push({ index: i, text, hash })
      }
    }

    if (uncached.length > 0) {
      const uncachedTexts = uncached.map(u => u.text)
      const embeddings = await provider.embed(uncachedTexts)

      for (let i = 0; i < uncached.length; i++) {
        const { index, hash } = uncached[i]!
        const embedding = embeddings[i]
        results[index] = embedding

        const cacheKey = `emb:${hash}`
        await cache.set(cacheKey, embedding, 86400)
      }
    }

    return results as number[][]
  }

  return { embedText, embedTexts }
}
