import { spawn, ChildProcess, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import { logger } from '../utils/logger'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const COQUI_PORT = parseInt(process.env.COQUI_PORT || '5554')
const COQUI_HOST = process.env.COQUI_HOST || '127.0.0.1'
const COQUI_DEVICE = process.env.COQUI_DEVICE || 'auto'
const COQUI_MODEL = process.env.COQUI_MODEL || 'tts_models/en/jenny/jenny'
const DEFAULT_VENV_DIR = path.join(os.homedir(), '.opencode-manager', 'coqui-venv')

interface CoquiServerStatus {
  running: boolean
  port: number
  host: string
  device: string | null
  model: string
  cudaAvailable: boolean
  error: string | null
}

interface CoquiVoice {
  id: string
  name: string
  description: string
}

class CoquiServerManager {
  private process: ChildProcess | null = null
  private status: CoquiServerStatus = {
    running: false,
    port: COQUI_PORT,
    host: COQUI_HOST,
    device: null,
    model: COQUI_MODEL,
    cudaAvailable: false,
    error: null
  }
  private startPromise: Promise<void> | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  getPort(): number {
    return COQUI_PORT
  }

  getHost(): string {
    return COQUI_HOST
  }

  getBaseUrl(): string {
    return `http://${COQUI_HOST}:${COQUI_PORT}`
  }

  getStatus(): CoquiServerStatus {
    return { ...this.status }
  }

  private findPythonBin(): string | null {
    if (process.env.COQUI_VENV) {
      const venvPython = path.join(process.env.COQUI_VENV, 'bin', 'python')
      if (fs.existsSync(venvPython)) {
        return venvPython
      }
    }

    const defaultVenvPython = path.join(DEFAULT_VENV_DIR, 'bin', 'python')
    if (fs.existsSync(defaultVenvPython)) {
      return defaultVenvPython
    }

    return null
  }

  private findCompatiblePython(): string | null {
    const candidates = ['python3.11', 'python3.12', 'python3.10', 'python3']
    for (const py of candidates) {
      try {
        execSync(`which ${py}`, { stdio: 'pipe' })
        return py
      } catch {
        continue
      }
    }
    return null
  }

  private async setupVenv(): Promise<string | null> {
    const pythonBin = this.findCompatiblePython()
    if (!pythonBin) {
      logger.warn('No compatible Python (3.10+) found for Coqui TTS')
      logger.warn('Install Python 3.11 with: brew install python@3.11')
      return null
    }

    logger.info(`Setting up Coqui TTS venv with ${pythonBin}...`)
    
    try {
      fs.mkdirSync(path.dirname(DEFAULT_VENV_DIR), { recursive: true })
      
      logger.info('Creating virtual environment...')
      execSync(`${pythonBin} -m venv "${DEFAULT_VENV_DIR}"`, { stdio: 'pipe' })
      
      const pip = path.join(DEFAULT_VENV_DIR, 'bin', 'pip')
      const venvPython = path.join(DEFAULT_VENV_DIR, 'bin', 'python')
      
      logger.info('Upgrading pip...')
      execSync(`"${pip}" install --upgrade pip`, { stdio: 'pipe', timeout: 120000 })
      
      logger.info('Installing PyTorch (this may take a few minutes)...')
      const torchCmd = os.platform() === 'darwin' && os.arch() === 'arm64'
        ? `"${pip}" install torch torchaudio`
        : `"${pip}" install torch torchaudio --index-url https://download.pytorch.org/whl/cpu`
      execSync(torchCmd, { stdio: 'pipe', timeout: 600000 })
      
      logger.info('Installing Coqui TTS (this may take a few minutes)...')
      execSync(`"${pip}" install TTS`, { stdio: 'pipe', timeout: 600000 })
      
      logger.info('Installing server dependencies...')
      execSync(`"${pip}" install fastapi uvicorn scipy numpy`, { stdio: 'pipe', timeout: 120000 })
      
      logger.info('Coqui TTS venv setup complete!')
      return venvPython
    } catch (error) {
      logger.error('Failed to setup Coqui TTS venv:', error)
      try {
        fs.rmSync(DEFAULT_VENV_DIR, { recursive: true, force: true })
      } catch {}
      return null
    }
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.status.running) {
      logger.info('Coqui TTS server already running')
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
    const possiblePaths = [
      path.resolve(__dirname, '..', '..', 'scripts', 'coqui-server.py'),
      path.resolve(__dirname, '..', '..', '..', 'scripts', 'coqui-server.py'),
      path.join(process.cwd(), 'scripts', 'coqui-server.py')
    ]
    
    let scriptPath: string | null = null
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        scriptPath = p
        break
      }
    }

    if (!scriptPath) {
      throw new Error(`Coqui TTS server script not found. Searched: ${possiblePaths.join(', ')}`)
    }

    let pythonBin = this.findPythonBin()
    
    if (!pythonBin) {
      logger.info('Coqui TTS venv not found, setting up automatically...')
      pythonBin = await this.setupVenv()
      if (!pythonBin) {
        throw new Error('Failed to setup Coqui TTS environment')
      }
    }

    logger.info(`Starting Coqui TTS server on ${COQUI_HOST}:${COQUI_PORT}`)
    logger.info(`Script path: ${scriptPath}`)
    logger.info(`Model: ${COQUI_MODEL}`)
    logger.info(`Using Python: ${pythonBin}`)

    const env = {
      ...process.env,
      COQUI_PORT: COQUI_PORT.toString(),
      COQUI_HOST: COQUI_HOST,
      COQUI_MODEL: COQUI_MODEL,
      COQUI_DEVICE: COQUI_DEVICE,
      PYTHONUNBUFFERED: '1'
    }

    this.process = spawn(pythonBin, [scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        logger.info(`[Coqui] ${message}`)
      }
    })

    this.process.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        if (message.includes('INFO') || message.includes('Uvicorn')) {
          logger.info(`[Coqui] ${message}`)
        } else {
          logger.error(`[Coqui] ${message}`)
        }
      }
    })

    this.process.on('error', (error) => {
      logger.error('Failed to start Coqui TTS server:', error)
      this.status.running = false
      this.status.error = error.message
    })

    this.process.on('exit', (code, signal) => {
      logger.info(`Coqui TTS server exited with code ${code}, signal ${signal}`)
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

  private async waitForReady(maxAttempts = 120, delayMs = 2000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (!this.process) {
        throw new Error('Coqui TTS server process exited unexpectedly')
      }

      try {
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        
        if (response.ok) {
          const data = await response.json() as { 
            device?: string
            cuda_available?: boolean
            model_name?: string
          }
          this.status.running = true
          this.status.device = data.device || null
          this.status.cudaAvailable = data.cuda_available || false
          this.status.model = data.model_name || COQUI_MODEL
          this.status.error = null
          logger.info(`Coqui TTS server is ready (device: ${data.device}, model: ${data.model_name})`)
          return
        }
      } catch {
        if (i % 10 === 0) {
          logger.debug(`Waiting for Coqui TTS server... attempt ${i + 1}/${maxAttempts}`)
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('Coqui TTS server failed to start within timeout')
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
            model_name?: string
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

    logger.info('Stopping Coqui TTS server...')
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Coqui TTS server did not exit gracefully, killing...')
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process!.once('exit', () => {
        clearTimeout(timeout)
        this.process = null
        this.status.running = false
        logger.info('Coqui TTS server stopped')
        resolve()
      })

      this.process!.kill('SIGTERM')
    })
  }

  async synthesize(text: string, options: {
    voice?: string
    speed?: number
  } = {}): Promise<Buffer> {
    if (!this.status.running) {
      throw new Error('Coqui TTS server is not running')
    }

    const response = await fetch(`${this.getBaseUrl()}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice: options.voice || 'default',
        speed: options.speed ?? 1.0
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
    voiceDetails: CoquiVoice[]
  }> {
    if (!this.status.running) {
      return {
        voices: ['default'],
        voiceDetails: [{
          id: 'default',
          name: 'Jenny',
          description: 'Default Jenny voice'
        }]
      }
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/voices`)
      if (response.ok) {
        const data = await response.json() as {
          voices: string[]
          voice_details: CoquiVoice[]
        }
        return {
          voices: data.voices,
          voiceDetails: data.voice_details
        }
      }
    } catch {
      logger.warn('Failed to fetch voices from Coqui TTS server')
    }

    return {
      voices: ['default'],
      voiceDetails: [{
        id: 'default',
        name: 'Jenny',
        description: 'Default Jenny voice'
      }]
    }
  }

  async getModels(): Promise<{
    models: Array<{ id: string; name: string; description: string }>
    currentModel: string
  }> {
    if (!this.status.running) {
      return {
        models: [{
          id: 'tts_models/en/jenny/jenny',
          name: 'Jenny',
          description: 'High-quality English female voice (recommended)'
        }],
        currentModel: COQUI_MODEL
      }
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/models`)
      if (response.ok) {
        const data = await response.json() as {
          models: Array<{ id: string; name: string; description: string }>
          current_model: string
        }
        return {
          models: data.models,
          currentModel: data.current_model
        }
      }
    } catch {
      logger.warn('Failed to fetch models from Coqui TTS server')
    }

    return {
      models: [{
        id: 'tts_models/en/jenny/jenny',
        name: 'Jenny',
        description: 'High-quality English female voice (recommended)'
      }],
      currentModel: COQUI_MODEL
    }
  }
}

export const coquiServerManager = new CoquiServerManager()
