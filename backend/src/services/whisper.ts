import { spawn, ChildProcess } from 'child_process'
import { logger } from '../utils/logger'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import path from 'path'

const WHISPER_PORT = parseInt(process.env.WHISPER_PORT || '5552')
const WHISPER_HOST = process.env.WHISPER_HOST || '127.0.0.1'
const WHISPER_DEFAULT_MODEL = process.env.WHISPER_DEFAULT_MODEL || 'base'

interface WhisperServerStatus {
  running: boolean
  port: number
  host: string
  model: string | null
  error: string | null
}

class WhisperServerManager {
  private process: ChildProcess | null = null
  private status: WhisperServerStatus = {
    running: false,
    port: WHISPER_PORT,
    host: WHISPER_HOST,
    model: null,
    error: null
  }
  private startPromise: Promise<void> | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  getPort(): number {
    return WHISPER_PORT
  }

  getHost(): string {
    return WHISPER_HOST
  }

  getBaseUrl(): string {
    return `http://${WHISPER_HOST}:${WHISPER_PORT}`
  }

  getStatus(): WhisperServerStatus {
    return { ...this.status }
  }

  async syncStatus(): Promise<WhisperServerStatus> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      
      if (response.ok) {
        const data = await response.json() as { current_model?: string }
        this.status.running = true
        this.status.model = data.current_model || null
        this.status.error = null
      } else {
        this.status.running = false
        this.status.error = 'Health check failed'
      }
    } catch (error) {
      this.status.running = false
      this.status.error = error instanceof Error ? error.message : 'Health check failed'
    }
    return { ...this.status }
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.status.running) {
      logger.info('Whisper server already running')
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
    const scriptPath = path.join(process.cwd(), 'scripts', 'whisper-server.py')
    const modelsDir = path.join(getWorkspacePath(), 'cache', 'whisper-models')

    logger.info(`Starting Whisper server on ${WHISPER_HOST}:${WHISPER_PORT}`)
    logger.info(`Script path: ${scriptPath}`)
    logger.info(`Models directory: ${modelsDir}`)

    const env = {
      ...process.env,
      WHISPER_PORT: WHISPER_PORT.toString(),
      WHISPER_HOST: WHISPER_HOST,
      WHISPER_MODELS_DIR: modelsDir,
      WHISPER_DEFAULT_MODEL: WHISPER_DEFAULT_MODEL,
      PYTHONUNBUFFERED: '1'
    }

    const venvPath = process.env.WHISPER_VENV
    const pythonBin = venvPath ? path.join(venvPath, 'bin', 'python') : 'python3'

    logger.info(`Using Python: ${pythonBin}`)

    this.process = spawn(pythonBin, [scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        logger.info(`[Whisper] ${message}`)
      }
    })

    this.process.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        if (message.includes('INFO') || message.includes('Uvicorn')) {
          logger.info(`[Whisper] ${message}`)
        } else {
          logger.error(`[Whisper] ${message}`)
        }
      }
    })

    this.process.on('error', (error) => {
      logger.error('Failed to start Whisper server:', error)
      this.status.running = false
      this.status.error = error.message
    })

    this.process.on('exit', (code, signal) => {
      logger.info(`Whisper server exited with code ${code}, signal ${signal}`)
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

  private async waitForReady(maxAttempts = 30, delayMs = 1000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(2000)
        })
        
        if (response.ok) {
          const data = await response.json() as { current_model?: string }
          this.status.running = true
          this.status.model = data.current_model || null
          this.status.error = null
          logger.info('Whisper server is ready')
          return
        }
      } catch {
        logger.debug(`Waiting for Whisper server... attempt ${i + 1}/${maxAttempts}`)
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('Whisper server failed to start within timeout')
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        
        if (response.ok) {
          const data = await response.json() as { current_model?: string }
          this.status.running = true
          this.status.model = data.current_model || null
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

    logger.info('Stopping Whisper server...')
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Whisper server did not exit gracefully, killing...')
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process!.once('exit', () => {
        clearTimeout(timeout)
        this.process = null
        this.status.running = false
        logger.info('Whisper server stopped')
        resolve()
      })

      this.process!.kill('SIGTERM')
    })
  }

  async transcribe(audioData: Buffer, options: {
    model?: string
    language?: string
    format?: string
  } = {}): Promise<{
    text: string
    language: string
    language_probability: number
    duration: number
  }> {
    await this.syncStatus()
    if (!this.status.running) {
      throw new Error('Whisper server is not running')
    }

    const base64Audio = audioData.toString('base64')
    
    const TRANSCRIBE_TIMEOUT_MS = 120000
    const response = await fetch(`${this.getBaseUrl()}/transcribe-base64`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio: base64Audio,
        model: options.model || WHISPER_DEFAULT_MODEL,
        language: options.language,
        format: options.format || 'webm'
      }),
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Transcription failed: ${error}`)
    }

    return response.json()
  }

  async getModels(): Promise<{
    models: string[]
    current: string | null
    default: string
  }> {
    if (!this.status.running) {
      return {
        models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
        current: null,
        default: WHISPER_DEFAULT_MODEL
      }
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/models`)
      if (response.ok) {
        return response.json()
      }
    } catch {
      logger.warn('Failed to fetch models from Whisper server')
    }

    return {
      models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
      current: this.status.model,
      default: WHISPER_DEFAULT_MODEL
    }
  }
}

export const whisperServerManager = new WhisperServerManager()
