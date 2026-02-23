import type { EmbeddingProvider } from './types'

interface ModelDefaults {
  dimensions: number
  endpoint: string
}

const KNOWN_MODELS: Record<string, ModelDefaults> = {
  'text-embedding-3-small': { dimensions: 1536, endpoint: 'https://api.openai.com/v1/embeddings' },
  'text-embedding-3-large': { dimensions: 3072, endpoint: 'https://api.openai.com/v1/embeddings' },
  'text-embedding-ada-002': { dimensions: 1536, endpoint: 'https://api.openai.com/v1/embeddings' },
  'voyage-code-3': { dimensions: 1024, endpoint: 'https://api.voyageai.com/v1/embeddings' },
  'voyage-2': { dimensions: 1536, endpoint: 'https://api.voyageai.com/v1/embeddings' },
}

const DEFAULT_PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/embeddings',
  voyage: 'https://api.voyageai.com/v1/embeddings',
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1/embeddings')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/embeddings`
  return `${trimmed}/v1/embeddings`
}

export class ApiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string
  private model: string
  private endpoint: string
  readonly dimensions: number

  constructor(
    provider: 'openai' | 'voyage',
    model?: string,
    baseUrl?: string,
    dimensions?: number,
    apiKey?: string
  ) {
    const knownDefaults = model ? KNOWN_MODELS[model] : undefined
    this.model = model || (provider === 'openai' ? 'text-embedding-3-small' : 'voyage-code-3')
    this.dimensions = dimensions || knownDefaults?.dimensions || 1536

    this.endpoint = baseUrl
      ? normalizeBaseUrl(baseUrl)
      : knownDefaults?.endpoint ?? DEFAULT_PROVIDER_ENDPOINTS[provider] ?? 'https://api.openai.com/v1/embeddings'

    this.apiKey = apiKey ?? ''
  }

  get name(): string {
    return `api:${this.model}`
  }

  get ready(): boolean {
    return true
  }

  warmup(): void {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    const batchSize = 100

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchResults = await this.embedBatch(batch)
      results.push(...batchResults)
    }

    return results
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const body = { model: this.model, input: texts }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Embedding API error: ${response.status} ${error}`)
    }

    const data = await response.json() as {
      data?: Array<{ embedding: number[] }>
      embeddings?: Array<{ embedding: number[] }>
    }

    const embeddings = data.data || data.embeddings
    if (!embeddings) {
      throw new Error('Invalid response from embedding API')
    }

    return embeddings.map(e => e.embedding)
  }

  async test(): Promise<boolean> {
    try {
      const result = await this.embed(['test'])
      return result.length === 1 && result[0]?.length === this.dimensions
    } catch {
      return false
    }
  }

  dispose(): void {
    // No-op for API-based providers - connections are managed by fetch
  }
}
