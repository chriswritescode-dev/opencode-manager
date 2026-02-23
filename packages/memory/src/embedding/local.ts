import { join } from 'path'
import { resolveDataDir } from '../storage/database'
import type { EmbeddingProvider } from './types'

interface LocalModelConfig {
  name: string
  dimensions: number
}

const LOCAL_MODELS: Record<string, LocalModelConfig> = {
  'all-MiniLM-L6-v2': {
    name: 'sentence-transformers/all-MiniLM-L6-v2',
    dimensions: 384,
  },
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private pipeline: unknown = null
  private loadingPromise: Promise<void> | null = null
  readonly dimensions: number
  private modelName: string

  constructor(model: string = 'all-MiniLM-L6-v2') {
    let modelConfig = LOCAL_MODELS[model]
    if (!modelConfig) {
      modelConfig = LOCAL_MODELS['all-MiniLM-L6-v2']
      model = 'all-MiniLM-L6-v2'
    }

    this.dimensions = modelConfig!.dimensions
    this.modelName = modelConfig!.name
  }

  get name(): string {
    return `local:${this.dimensions}d`
  }

  get ready(): boolean {
    return this.pipeline !== null
  }

  warmup(): void {
    if (this.pipeline || this.loadingPromise) return
    this.loadingPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.cacheDir = join(resolveDataDir(), 'models')
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        dtype: 'fp32',
      })
    })()
    this.loadingPromise.catch(() => {
      this.loadingPromise = null
    })
  }

  private async loadModel(modelName: string): Promise<void> {
    if (this.pipeline) return

    this.loadingPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.cacheDir = join(resolveDataDir(), 'models')
      this.pipeline = await pipeline('feature-extraction', modelName, {
        dtype: 'fp32',
      })
    })()

    return this.loadingPromise
  }

  async ensureLoaded(): Promise<void> {
    if (this.pipeline) return
    if (!this.loadingPromise) {
      await this.loadModel(this.modelName)
    } else {
      await this.loadingPromise
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded()

    if (!this.pipeline) {
      throw new Error('Embedding model not loaded')
    }

    const pipeline = this.pipeline as {
      (text: string, options: { pooling: string; normalize: boolean }): Promise<unknown>
    }

    const results: number[][] = []

    for (const text of texts) {
      try {
        const output = await pipeline(text, {
          pooling: 'mean',
          normalize: true,
        }) as { data: Float32Array }

        const embedding = Array.from(output.data)
        results.push(embedding)
      } catch {
        results.push(new Array(this.dimensions).fill(0))
      }
    }

    return results
  }

  async test(): Promise<boolean> {
    try {
      await this.ensureLoaded()
      const result = await this.embed(['test'])
      return result.length === 1 && result[0]?.length === this.dimensions
    } catch {
      return false
    }
  }

  dispose(): void {
    if (this.pipeline && typeof (this.pipeline as { dispose?: () => void }).dispose === 'function') {
      (this.pipeline as { dispose: () => void }).dispose()
    }
    this.pipeline = null
    this.loadingPromise = null
  }
}
