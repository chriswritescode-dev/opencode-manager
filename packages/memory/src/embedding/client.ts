import { join } from 'path'
import { resolveDataDir } from '../storage/database'
import type { EmbeddingProvider } from './types'
import { acquireEmbeddingServer, isServerRunning, checkServerHealth } from './shared'
import { LocalEmbeddingProvider } from './local'

interface SharedEmbeddingClientConfig {
  dataDir?: string
  model: string
  dimensions: number
  gracePeriod?: number
}

type ConnectionState = 'idle' | 'server' | 'local'

export class SharedEmbeddingClient implements EmbeddingProvider {
  readonly dimensions: number
  private socketPath: string
  private modelName: string
  private state: ConnectionState = 'idle'
  private localProvider: LocalEmbeddingProvider | null = null
  private warmupPromise: Promise<void> | null = null

  constructor(config: SharedEmbeddingClientConfig) {
    this.modelName = config.model
    this.dimensions = config.dimensions
    this.socketPath = join(config.dataDir ?? resolveDataDir(), 'embedding.sock')
  }

  get name(): string {
    return `shared:local:${this.dimensions}d`
  }

  get ready(): boolean {
    return this.state !== 'idle'
  }

  warmup(): void {
    if (this.state !== 'idle' || this.warmupPromise) return
    this.warmupPromise = this.ensureConnected().then(() => {}).catch(() => {
      this.warmupPromise = null
    })
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.state === 'server') return true
    if (this.state === 'local') return true

    const dataDir = join(this.socketPath, '..')
    const running = await isServerRunning(dataDir)
    
    if (!running) {
      const success = await acquireEmbeddingServer({
        dataDir,
        model: this.modelName,
        dimensions: this.dimensions,
      })

      if (!success) {
        return this.createFallbackProvider()
      }
    }

    try {
      const response = await this.sendRequest({ action: 'connect' })
      if (response && response.status === 'connected') {
        this.state = 'server'
        return true
      }
      return this.createFallbackProvider()
    } catch {
      return this.createFallbackProvider()
    }
  }

  private async createFallbackProvider(): Promise<boolean> {
    this.localProvider = new LocalEmbeddingProvider(this.modelName)
    await this.localProvider.ensureLoaded()
    this.state = 'local'
    return true
  }

  private async sendRequest(request: { action: string; texts?: string[] }): Promise<Record<string, unknown> | null> {
    const net = await import('net')
    
    return new Promise((resolve) => {
      const client = net.createConnection({ path: this.socketPath })
      let data = ''

      const timeout = setTimeout(() => {
        client.destroy()
        resolve(null)
      }, 30000)

      client.on('connect', () => {
        client.write(JSON.stringify(request) + '\n')
      })

      client.on('data', (chunk: Buffer) => {
        data += chunk.toString()
        const lines = data.split('\n')
        
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const response = JSON.parse(line)
            clearTimeout(timeout)
            client.end()
            resolve(response)
            return
          } catch {
            // Continue waiting
          }
        }
      })

      client.on('error', () => {
        clearTimeout(timeout)
        client.destroy()
        resolve(null)
      })
    })
  }

  async embed(texts: string[]): Promise<number[][]> {
    const localProvider = this.localProvider
    if (localProvider) {
      return localProvider.embed(texts)
    }

    await this.ensureConnected()

    const provider = this.localProvider
    if (provider) {
      return provider.embed(texts)
    }

    const response = await this.sendRequest({ action: 'embed', texts })
    
    if (!response || response.error) {
      await this.createFallbackProvider()
      const fallbackProvider = this.localProvider
      if (fallbackProvider) {
        return fallbackProvider.embed(texts)
      }
      return texts.map(() => new Array(this.dimensions).fill(0))
    }

    return (response.embeddings as number[][]) ?? []
  }

  async test(): Promise<boolean> {
    const localProvider = this.localProvider
    if (localProvider) {
      return localProvider.test()
    }

    try {
      const health = await checkServerHealth(this.socketPath)
      if (health && health.status === 'ok') {
        return true
      }
      
      await this.ensureConnected()
      
      const testProvider = this.localProvider
      if (testProvider) {
        return testProvider.test()
      }
      
      return false
    } catch {
      return false
    }
  }

  dispose(): void {
    if (this.localProvider) {
      this.localProvider.dispose()
      this.localProvider = null
      this.state = 'idle'
      return
    }

    if (this.state === 'server') {
      this.sendRequest({ action: 'disconnect' }).catch(() => {})
    }

    this.state = 'idle'
  }
}
