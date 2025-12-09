import { spawn, execSync } from 'child_process'
import path from 'path'
import { logger } from '../utils/logger'
import { SettingsService } from './settings'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-webui/shared'
import type { Database } from 'bun:sqlite'

const OPENCODE_SERVER_PORT = ENV.OPENCODE.PORT
const OPENCODE_SERVER_DIRECTORY = getWorkspacePath()
const OPENCODE_CONFIG_PATH = getOpenCodeConfigFilePath()
const MIN_OPENCODE_VERSION = '1.0.137'

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
    logger.info(`OpenCode will use ?directory= parameter for session isolation`)
    
    
    this.serverProcess = spawn(
      'opencode', 
      ['serve', '--port', OPENCODE_SERVER_PORT.toString(), '--hostname', '127.0.0.1'],
      {
        cwd: OPENCODE_SERVER_DIRECTORY,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : 'ignore',
        env: {
          ...process.env,
          XDG_DATA_HOME: path.join(OPENCODE_SERVER_DIRECTORY, '.opencode/state'),
          OPENCODE_CONFIG: OPENCODE_CONFIG_PATH,
          GITHUB_TOKEN: gitToken,
          GIT_ASKPASS: gitToken ? 'echo $GITHUB_TOKEN' : 'echo',
          GIT_TERMINAL_PROMPT: '0'
        }
      }
    )

    this.serverPid = this.serverProcess.pid ?? null

    logger.info(`OpenCode server started with PID ${this.serverPid}`)

    const healthy = await this.waitForHealth(30000)
    if (!healthy) {
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
      const match = result.match(/(\d+\.\d+\.\d+)/)
      if (match && match[1]) {
        this.version = match[1]
        return this.version
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
