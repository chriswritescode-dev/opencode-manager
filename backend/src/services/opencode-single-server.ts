import { spawn, execSync } from 'child_process'
import path from 'path'
import { logger } from '../utils/logger'
import { createGitHubGitEnv, createNoPromptGitEnv } from '../utils/git-auth'
import { SettingsService } from './settings'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-manager/shared/config/env'
import type { Database } from 'bun:sqlite'

const OPENCODE_SERVER_PORT = ENV.OPENCODE.PORT
const OPENCODE_SERVER_DIRECTORY = getWorkspacePath()
const OPENCODE_CONFIG_PATH = getOpenCodeConfigFilePath()
const MIN_OPENCODE_VERSION = '1.0.137'
const MAX_STDERR_SIZE = 10240
const CLIENT_MODE = process.env.OPENCODE_CLIENT_MODE === 'true'

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

class OpenCodeServerManager {
  private static instance: OpenCodeServerManager
  private serverProcess: ReturnType<typeof spawn> | null = null
  private serverPid: number | null = null
  private isHealthy: boolean = false
  private db: Database | null = null
  private version: string | null = null
  private lastStartupError: string | null = null

  private constructor() {}

  setDatabase(db: Database) {
    this.db = db
  }

  static getInstance(): OpenCodeServerManager {
    if (!OpenCodeServerManager.instance) {
      OpenCodeServerManager.instance = new OpenCodeServerManager()
    }
    return OpenCodeServerManager.instance
  }

  async start(): Promise<void> {
    if (this.isHealthy) {
      logger.info('OpenCode server already running and healthy')
      return
    }

    if (CLIENT_MODE) {
      logger.info(`Client mode: connecting to existing OpenCode server on port ${OPENCODE_SERVER_PORT}`)
      const healthy = await this.waitForHealth(10000)
      if (healthy) {
        this.isHealthy = true
        await this.fetchVersion()
        logger.info(`Connected to OpenCode server v${this.version || 'unknown'}`)
        return
      }
      throw new Error(`Failed to connect to OpenCode server on port ${OPENCODE_SERVER_PORT}`)
    }

    const isDevelopment = ENV.SERVER.NODE_ENV !== 'production'
    
    let gitToken = ''
    if (this.db) {
      try {
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        gitToken = settings.preferences.gitToken || ''
      } catch (error) {
        logger.warn('Failed to get git token from settings:', error)
      }
    }
    
    const existingProcesses = await this.findProcessesByPort(OPENCODE_SERVER_PORT)
    if (existingProcesses.length > 0) {
      logger.info(`OpenCode server already running on port ${OPENCODE_SERVER_PORT}`)
      const healthy = await this.checkHealth()
      if (healthy) {
        if (isDevelopment) {
          logger.warn('Development mode: Killing existing server for hot reload')
          for (const proc of existingProcesses) {
            try {
              process.kill(proc.pid, 'SIGKILL')
            } catch (error) {
              logger.warn(`Failed to kill process ${proc.pid}:`, error)
            }
          }
          await new Promise(r => setTimeout(r, 2000))
        } else {
          this.isHealthy = true
          if (existingProcesses[0]) {
            this.serverPid = existingProcesses[0].pid
          }
          return
        }
      } else {
        logger.warn('Killing unhealthy OpenCode server')
        for (const proc of existingProcesses) {
          try {
            process.kill(proc.pid, 'SIGKILL')
          } catch (error) {
            logger.warn(`Failed to kill process ${proc.pid}:`, error)
          }
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    logger.info(`OpenCode server working directory: ${OPENCODE_SERVER_DIRECTORY}`)
    logger.info(`OpenCode XDG_CONFIG_HOME: ${path.join(OPENCODE_SERVER_DIRECTORY, '.config')}`)
    logger.info(`OpenCode will use ?directory= parameter for session isolation`)

    const gitEnv = gitToken ? createGitHubGitEnv(gitToken) : createNoPromptGitEnv()

    let stderrOutput = ''

    this.serverProcess = spawn(
      'opencode',
      ['serve', '--port', OPENCODE_SERVER_PORT.toString(), '--hostname', '127.0.0.1'],
      {
        cwd: OPENCODE_SERVER_DIRECTORY,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...gitEnv,
          XDG_DATA_HOME: path.join(OPENCODE_SERVER_DIRECTORY, '.opencode/state'),
          XDG_CONFIG_HOME: path.join(OPENCODE_SERVER_DIRECTORY, '.config'),
          OPENCODE_CONFIG: OPENCODE_CONFIG_PATH,
        }
      }
    )

    if (!isDevelopment && this.serverProcess.stderr) {
      this.serverProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString()
        if (stderrOutput.length > MAX_STDERR_SIZE) {
          stderrOutput = stderrOutput.slice(-MAX_STDERR_SIZE)
        }
      })
    }

    this.serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        this.lastStartupError = `Server exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
        logger.error('OpenCode server process exited:', this.lastStartupError)
      } else if (signal) {
        this.lastStartupError = `Server terminated by signal ${signal}`
        logger.error('OpenCode server process terminated:', this.lastStartupError)
      }
    })

    this.serverPid = this.serverProcess.pid ?? null

    logger.info(`OpenCode server started with PID ${this.serverPid}`)

    const healthy = await this.waitForHealth(30000)
    if (!healthy) {
      this.lastStartupError = `Server failed to become healthy after 30s${stderrOutput ? `. Last error: ${stderrOutput.slice(-500)}` : ''}`
      throw new Error('OpenCode server failed to become healthy')
    }

    this.isHealthy = true
    logger.info('OpenCode server is healthy')

    await this.fetchVersion()
    if (this.version) {
      logger.info(`OpenCode version: ${this.version}`)
      if (!this.isVersionSupported()) {
        logger.warn(`OpenCode version ${this.version} is below minimum required version ${MIN_OPENCODE_VERSION}`)
        logger.warn('Some features like MCP management may not work correctly')
      }
    }
  }

  async stop(): Promise<void> {
    if (CLIENT_MODE) {
      logger.info('Client mode: not stopping external OpenCode server')
      this.isHealthy = false
      return
    }

    if (!this.serverPid) return
    
    logger.info('Stopping OpenCode server')
    try {
      process.kill(this.serverPid, 'SIGTERM')
    } catch (error) {
      logger.warn(`Failed to send SIGTERM to ${this.serverPid}:`, error)
    }
    
    await new Promise(r => setTimeout(r, 2000))
    
    try {
      process.kill(this.serverPid, 0)
      process.kill(this.serverPid, 'SIGKILL')
    } catch {
      
    }
    
    this.serverPid = null
    this.isHealthy = false
  }

  async restart(): Promise<void> {
    logger.info('Restarting OpenCode server')
    await this.stop()
    await new Promise(r => setTimeout(r, 1000))
    await this.start()
  }

  getPort(): number {
    return OPENCODE_SERVER_PORT
  }

  getVersion(): string | null {
    return this.version
  }

  getMinVersion(): string {
    return MIN_OPENCODE_VERSION
  }

  isVersionSupported(): boolean {
    if (!this.version) return false
    return compareVersions(this.version, MIN_OPENCODE_VERSION) >= 0
  }

  getLastStartupError(): string | null {
    return this.lastStartupError
  }

  clearStartupError(): void {
    this.lastStartupError = null
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${OPENCODE_SERVER_PORT}/doc`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const result = execSync('opencode --version 2>&1', { encoding: 'utf8' })
      // Use a stricter regex to avoid matching IP addresses (e.g., 0.0.0.0) in debug output
      // We look for a version number at the end of a line or standing alone
      const lines = result.split('\n')
      for (const line of lines) {
        const match = line.match(/(?:^|\s|v)(\d+\.\d+\.\d+)(?:\s|$)/)
        if (match && match[1]) {
          // Verify it's not part of an IP address (heuristic: check if followed by another dot)
          const fullMatch = match[0]
          const index = line.indexOf(fullMatch)
          const nextChar = line[index + fullMatch.length]
          if (nextChar === '.') continue
          
          this.version = match[1]
          return this.version
        }
      }
    } catch (error) {
      logger.warn('Failed to get OpenCode version:', error)
    }
    return null
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth()) {
        return true
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  }

  private async findProcessesByPort(port: number): Promise<Array<{pid: number}>> {
    try {
      const pids = execSync(`lsof -ti:${port}`).toString().trim().split('\n')
      return pids.filter(Boolean).map(pid => ({ pid: parseInt(pid) }))
    } catch {
      return []
    }
  }
}

export const opencodeServerManager = OpenCodeServerManager.getInstance()
