import { spawn, ChildProcess } from 'child_process'
import { logger } from '../utils/logger'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import path from 'path'

const CHATTERBOX_PORT = parseInt(process.env.CHATTERBOX_PORT || '5553')
const CHATTERBOX_HOST = process.env.CHATTERBOX_HOST || '127.0.0.1'
const CHATTERBOX_DEVICE = process.env.CHATTERBOX_DEVICE || 'auto'

interface ChatterboxServerStatus {
  running: boolean
  port: number
  host: string
  device: string | null
  cudaAvailable: boolean
  error: string | null
}

interface ChatterboxVoice {
  id: string
  name: string
  description: string
  is_custom?: boolean
}

class ChatterboxServerManager {
  private process: ChildProcess | null = null
  private status: ChatterboxServerStatus = {
    running: false,
    port: CHATTERBOX_PORT,
    host: CHATTERBOX_HOST,
    device: null,
    cudaAvailable: false,
    error: null
  }
  private startPromise: Promise<void> | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  getPort(): number {
    return CHATTERBOX_PORT
  }

  getHost(): string {
    return CHATTERBOX_HOST
  }

  getBaseUrl(): string {
    return `http://${CHATTERBOX_HOST}:${CHATTERBOX_PORT}`
  }

  getStatus(): ChatterboxServerStatus {
    return { ...this.status }
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.status.running) {
      logger.info('Chatterbox server already running')
      return
    }

    this.startPromise = this.doStart()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async doStart(): Promise<void> {
    const scriptPath = path.join(process.cwd(), 'scripts', 'chatterbox-server.py')
    const voiceSamplesDir = path.join(getWorkspacePath(), 'cache', 'chatterbox-voices')

    logger.info(`Starting Chatterbox server on ${CHATTERBOX_HOST}:${CHATTERBOX_PORT}`)
    logger.info(`Script path: ${scriptPath}`)
    logger.info(`Voice samples directory: ${voiceSamplesDir}`)

    const env = {
      ...process.env,
      CHATTERBOX_PORT: CHATTERBOX_PORT.toString(),
      CHATTERBOX_HOST: CHATTERBOX_HOST,
      CHATTERBOX_VOICE_SAMPLES_DIR: voiceSamplesDir,
      CHATTERBOX_DEVICE: CHATTERBOX_DEVICE,
      PYTHONUNBUFFERED: '1'
    }

    const venvPath = process.env.CHATTERBOX_VENV || process.env.WHISPER_VENV
    const pythonBin = venvPath ? path.join(venvPath, 'bin', 'python') : 'python3'

    logger.info(`Using Python: ${pythonBin}`)

    this.process = spawn(pythonBin, [scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        logger.info(`[Chatterbox] ${message}`)
      }
    })

    this.process.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        if (message.includes('INFO') || message.includes('Uvicorn')) {
          logger.info(`[Chatterbox] ${message}`)
        } else {
          logger.error(`[Chatterbox] ${message}`)
        }
      }
    })

    this.process.on('error', (error) => {
      logger.error('Failed to start Chatterbox server:', error)
      this.status.running = false
      this.status.error = error.message
    })

    this.process.on('exit', (code, signal) => {
      logger.info(`Chatterbox server exited with code ${code}, signal ${signal}`)
      this.status.running = false
      this.process = null
      
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
        this.healthCheckInterval = null
      }
    })

    await this.waitForReady()
    this.startHealthCheck()
  }

  private async waitForReady(maxAttempts = 60, delayMs = 2000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (!this.process) {
        throw new Error('Chatterbox server process exited unexpectedly')
      }

      try {
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        
        if (response.ok) {
          const data = await response.json() as { 
            device?: string
            cuda_available?: boolean 
          }
          this.status.running = true
          this.status.device = data.device || null
          this.status.cudaAvailable = data.cuda_available || false
          this.status.error = null
          logger.info(`Chatterbox server is ready (device: ${data.device}, CUDA: ${data.cuda_available})`)
          return
        }
      } catch {
        logger.debug(`Waiting for Chatterbox server... attempt ${i + 1}/${maxAttempts}`)
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('Chatterbox server failed to start within timeout')
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        
        if (response.ok) {
          const data = await response.json() as { 
            device?: string
            cuda_available?: boolean 
          }
          this.status.running = true
          this.status.device = data.device || null
          this.status.cudaAvailable = data.cuda_available || false
          this.status.error = null
        } else {
          this.status.running = false
          this.status.error = 'Health check failed'
        }
      } catch (error) {
        this.status.running = false
        this.status.error = error instanceof Error ? error.message : 'Health check failed'
      }
    }, 30000)
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    if (!this.process) {
      return
    }

    logger.info('Stopping Chatterbox server...')
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Chatterbox server did not exit gracefully, killing...')
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process!.once('exit', () => {
        clearTimeout(timeout)
        this.process = null
        this.status.running = false
        logger.info('Chatterbox server stopped')
        resolve()
      })

      this.process!.kill('SIGTERM')
    })
  }

  async synthesize(text: string, options: {
    voice?: string
    exaggeration?: number
    cfgWeight?: number
  } = {}): Promise<Buffer> {
    if (!this.status.running) {
      throw new Error('Chatterbox server is not running')
    }

    const response = await fetch(`${this.getBaseUrl()}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice: options.voice || 'default',
        exaggeration: options.exaggeration ?? 0.5,
        cfg_weight: options.cfgWeight ?? 0.5
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Synthesis failed: ${error}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  async getVoices(): Promise<{
    voices: string[]
    voiceDetails: ChatterboxVoice[]
  }> {
    if (!this.status.running) {
      return {
        voices: ['default'],
        voiceDetails: [{
          id: 'default',
          name: 'Default Voice',
          description: 'Built-in default voice'
        }]
      }
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/voices`)
      if (response.ok) {
        const data = await response.json() as {
          voices: string[]
          voice_details: ChatterboxVoice[]
        }
        return {
          voices: data.voices,
          voiceDetails: data.voice_details
        }
      }
    } catch {
      logger.warn('Failed to fetch voices from Chatterbox server')
    }

    return {
      voices: ['default'],
      voiceDetails: [{
        id: 'default',
        name: 'Default Voice',
        description: 'Built-in default voice'
      }]
    }
  }

  async uploadVoice(audioData: Buffer, name: string, filename: string): Promise<{
    voiceId: string
    path: string
  }> {
    if (!this.status.running) {
      throw new Error('Chatterbox server is not running')
    }

    const formData = new FormData()
    formData.append('audio', new Blob([audioData]), filename)
    formData.append('name', name)

    const response = await fetch(`${this.getBaseUrl()}/voices/upload`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Voice upload failed: ${error}`)
    }

    const data = await response.json() as {
      voice_id: string
      path: string
    }

    return {
      voiceId: data.voice_id,
      path: data.path
    }
  }

  async deleteVoice(voiceId: string): Promise<void> {
    if (!this.status.running) {
      throw new Error('Chatterbox server is not running')
    }

    const response = await fetch(`${this.getBaseUrl()}/voices/${voiceId}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Voice deletion failed: ${error}`)
    }
  }
}

export const chatterboxServerManager = new ChatterboxServerManager()
