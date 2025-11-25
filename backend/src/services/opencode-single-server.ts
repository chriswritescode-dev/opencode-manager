import { spawn, execSync } from 'child_process'
import path from 'path'
import { logger } from '../utils/logger'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '../config'

const OPENCODE_SERVER_PORT = ENV.OPENCODE.PORT
const OPENCODE_SERVER_DIRECTORY = getWorkspacePath()
const OPENCODE_CONFIG_PATH = getOpenCodeConfigFilePath()

class OpenCodeServerManager {
  private static instance: OpenCodeServerManager
  private serverProcess: any = null
  private serverPid: number | null = null
  private isHealthy: boolean = false

  private constructor() {}

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
          OPENCODE_CONFIG: OPENCODE_CONFIG_PATH
        }
      }
    )

    this.serverPid = this.serverProcess.pid

    logger.info(`OpenCode server started with PID ${this.serverPid}`)

    const healthy = await this.waitForHealth(30000)
    if (!healthy) {
      throw new Error('OpenCode server failed to become healthy')
    }

    this.isHealthy = true
    logger.info('OpenCode server is healthy')
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

  getPort(): number {
    return OPENCODE_SERVER_PORT
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
