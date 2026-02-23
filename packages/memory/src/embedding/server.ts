import { createServer } from 'net'
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { LocalEmbeddingProvider } from './local'

interface ServerConfig {
  socketPath: string
  pidPath: string
  model: string
  dimensions: number
  gracePeriod: number
}

class EmbeddingServer {
  private config: ServerConfig
  private provider: LocalEmbeddingProvider | null = null
  private clientCount = 0
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null
  private startTime = Date.now()
  private server: ReturnType<typeof createServer> | null = null

  constructor(config: ServerConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    await this.loadModel()
    this.writePidFile()
    this.startServer()
    this.setupSignalHandlers()
  }

  private async loadModel(): Promise<void> {
    this.provider = new LocalEmbeddingProvider(this.config.model)
    await this.provider.ensureLoaded()
  }

  private writePidFile(): void {
    writeFileSync(this.config.pidPath, String(process.pid), 'utf-8')
  }

  private removePidFile(): void {
    try {
      if (existsSync(this.config.pidPath)) {
        unlinkSync(this.config.pidPath)
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private startServer(): void {
    const socketDir = join(this.config.socketPath, '..')
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true })
    }

    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath)
    }

    this.server = createServer((socket) => {
      let buffer = ''

      socket.on('data', async (data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          
          try {
            const request = JSON.parse(line) as { action: string; texts?: string[] }
            const response = await this.handleRequest(request)
            socket.write(JSON.stringify(response) + '\n')
          } catch (error) {
            const errorResponse = { 
              error: 'Internal server error', 
              message: error instanceof Error ? error.message : String(error) 
            }
            socket.write(JSON.stringify(errorResponse) + '\n')
          }
        }
      })

      socket.on('close', () => {
        // Socket closed
      })

      socket.on('error', (error) => {
        console.error('Socket error:', error)
      })
    })

    this.server.listen(this.config.socketPath)
  }

  private setupSignalHandlers(): void {
    process.on('SIGTERM', () => this.shutdown())
    process.on('SIGINT', () => this.shutdown())
  }

  private async handleRequest(request: { action: string; texts?: string[] }): Promise<Record<string, unknown>> {
    const { action, texts } = request

    switch (action) {
      case 'embed':
        if (!texts || !Array.isArray(texts)) {
          return { error: 'Missing or invalid texts array' }
        }
        return this.handleEmbed(texts)

      case 'health':
        return this.handleHealth()

      case 'connect':
        return this.handleConnect()

      case 'disconnect':
        return this.handleDisconnect()

      default:
        return { error: `Unknown action: ${action}` }
    }
  }

  private async handleEmbed(texts: string[]): Promise<Record<string, unknown>> {
    if (!this.provider) {
      return { error: 'Provider not initialized' }
    }

    try {
      const embeddings = await this.provider.embed(texts)
      return { embeddings }
    } catch (error) {
      return { 
        error: 'Embedding failed', 
        details: error instanceof Error ? error.message : String(error) 
      }
    }
  }

  private handleHealth(): Record<string, unknown> {
    return {
      status: 'ok',
      clients: this.clientCount,
      uptime: Date.now() - this.startTime,
      dimensions: this.config.dimensions,
      model: this.config.model,
    }
  }

  private handleConnect(): Record<string, unknown> {
    this.clientCount++
    this.cancelGracePeriod()
    
    return { 
      status: 'connected', 
      clients: this.clientCount 
    }
  }

  private handleDisconnect(): Record<string, unknown> {
    this.clientCount = Math.max(0, this.clientCount - 1)
    
    if (this.clientCount === 0) {
      this.startGracePeriod()
    }
    
    return { 
      status: 'disconnected', 
      clients: this.clientCount 
    }
  }

  private cancelGracePeriod(): void {
    if (this.gracePeriodTimer) {
      clearTimeout(this.gracePeriodTimer)
      this.gracePeriodTimer = null
    }
  }

  private startGracePeriod(): void {
    this.cancelGracePeriod()
    
    this.gracePeriodTimer = setTimeout(() => {
      if (this.clientCount === 0) {
        this.shutdown()
      }
    }, this.config.gracePeriod)
  }

  private shutdown(): void {
    this.cancelGracePeriod()
    
    if (this.server) {
      this.server.close()
      this.server = null
    }

    try {
      if (existsSync(this.config.socketPath)) {
        unlinkSync(this.config.socketPath)
      }
    } catch {
      // Ignore cleanup errors
    }

    this.removePidFile()

    if (this.provider) {
      this.provider.dispose()
      this.provider = null
    }

    process.exit(0)
  }
}

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2)
  
  let socketPath = '/tmp/embedding.sock'
  let pidPath = '/tmp/embedding.pid'
  let model = 'all-MiniLM-L6-v2'
  let dimensions = 384
  let gracePeriod = 30000

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    switch (arg) {
      case '--socket':
        socketPath = args[++i]
        break
      case '--pid':
        pidPath = args[++i]
        break
      case '--model':
        model = args[++i]
        break
      case '--dimensions':
        dimensions = parseInt(args[++i], 10)
        break
      case '--grace-period':
        gracePeriod = parseInt(args[++i], 10)
        break
    }
  }

  return { socketPath, pidPath, model, dimensions, gracePeriod }
}

async function main(): Promise<void> {
  const config = parseArgs()
  const server = new EmbeddingServer(config)
  
  await server.start()
}

main().catch((error) => {
  console.error('Failed to start embedding server:', error)
  process.exit(1)
})
