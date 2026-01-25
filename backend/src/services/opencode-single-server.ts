import { spawn, execSync } from 'child_process'
import path from 'path'
import { logger } from '../utils/logger'
import { createGitHubGitEnv, createNoPromptGitEnv } from '../utils/git-auth'
import { SettingsService } from './settings'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-manager/shared/config/env'
import type { Database } from 'bun:sqlite'
import { openCodeDiscoveryService, type OpenCodeInstance } from './opencode-discovery'
import { opencodeSdkClient } from './opencode-sdk-client'

const OPENCODE_SERVER_PORT = ENV.OPENCODE.PORT
const OPENCODE_SERVER_DIRECTORY = getWorkspacePath()
const OPENCODE_CONFIG_PATH = getOpenCodeConfigFilePath()
const MIN_OPENCODE_VERSION = '1.0.137'
const MAX_STDERR_SIZE = 10240
const CLIENT_MODE = process.env.OPENCODE_CLIENT_MODE === 'true'
const HEALTH_CHECK_INTERVAL = 5000
const MAX_RECONNECT_DELAY = 30000
const BASE_RECONNECT_DELAY = 1000

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
  private connectedDirectory: string | null = null
  private healthCheckInterval: NodeJS.Timeout | null = null
  private reconnectAttempts: number = 0
  private activePort: number = OPENCODE_SERVER_PORT
  private isReconnecting: boolean = false

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
      logger.info(`Client mode: discovering OpenCode instances...`)
      
      const instance = await this.discoverAndConnect()
      if (instance) {
        this.isHealthy = true
        this.activePort = instance.port
        this.version = instance.version
        this.connectedDirectory = instance.directory
        this.reconnectAttempts = 0
        opencodeSdkClient.configure(this.activePort)
        logger.info(`Connected to OpenCode server v${this.version || 'unknown'} on port ${this.activePort}`)
        if (this.connectedDirectory) {
          logger.info(`OpenCode server directory: ${this.connectedDirectory}`)
        }
        this.startHealthMonitor()
        return
      }
      
      const configuredHealthy = await this.waitForHealth(10000)
      if (configuredHealthy) {
        this.isHealthy = true
        this.activePort = OPENCODE_SERVER_PORT
        opencodeSdkClient.configure(this.activePort)
        await this.fetchVersion()
        await this.fetchConnectedDirectory()
        logger.info(`Connected to OpenCode server v${this.version || 'unknown'} on port ${this.activePort}`)
        if (this.connectedDirectory) {
          logger.info(`OpenCode server directory: ${this.connectedDirectory}`)
        }
        this.startHealthMonitor()
        return
      }
      
      logger.warn(`No OpenCode servers found. Will keep monitoring for instances...`)
      this.startHealthMonitor()
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
          // Use system default XDG_DATA_HOME (~/.local/share) to share sessions with CLI
          // Only override XDG_CONFIG_HOME for workspace-specific config
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
      this.activePort = OPENCODE_SERVER_PORT
      opencodeSdkClient.configure(this.activePort)
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
    this.stopHealthMonitor()
    
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

  getConnectedDirectory(): string | null {
    return this.connectedDirectory
  }

  isClientMode(): boolean {
    return CLIENT_MODE
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

  async fetchConnectedDirectory(): Promise<string | null> {
    if (!CLIENT_MODE) return null
    
    try {
      const response = await fetch(`http://127.0.0.1:${OPENCODE_SERVER_PORT}/session`, {
        signal: AbortSignal.timeout(5000)
      })
      if (response.ok) {
        const sessions = await response.json() as Array<{ directory?: string }>
        if (sessions.length > 0 && sessions[0]?.directory) {
          this.connectedDirectory = sessions[0].directory
          return this.connectedDirectory
        }
      }
    } catch (error) {
      logger.warn('Failed to get OpenCode server directory:', error)
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

  private async discoverAndConnect(): Promise<OpenCodeInstance | null> {
    const instances = await openCodeDiscoveryService.discoverInstances()
    if (instances.length === 0) {
      return null
    }

    logger.info(`Found ${instances.length} OpenCode instance(s)`)
    for (const instance of instances) {
      logger.info(`  - Port ${instance.port}: ${instance.directory || 'unknown dir'} (${instance.sessions.length} sessions)`)
    }

    return instances[0] || null
  }

  private startHealthMonitor(): void {
    if (this.healthCheckInterval) {
      return
    }

    logger.info('Starting OpenCode health monitor')
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck()
    }, HEALTH_CHECK_INTERVAL)
  }

  private stopHealthMonitor(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (this.isReconnecting) {
      return
    }

    const healthy = await this.checkHealthOnPort(this.activePort)
    
    if (healthy && !this.isHealthy) {
      logger.info(`OpenCode server on port ${this.activePort} is now healthy`)
      this.isHealthy = true
      this.reconnectAttempts = 0
      this.lastStartupError = null
      await this.fetchVersionFromPort(this.activePort)
      await this.fetchConnectedDirectoryFromPort(this.activePort)
    } else if (!healthy && this.isHealthy) {
      logger.warn(`OpenCode server on port ${this.activePort} became unhealthy`)
      this.isHealthy = false
      this.scheduleReconnect()
    } else if (!healthy && !this.isHealthy) {
      await this.tryDiscoverNewInstance()
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isReconnecting) {
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++
    
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    )
    
    logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)
    
    setTimeout(async () => {
      await this.attemptReconnect()
      this.isReconnecting = false
    }, delay)
  }

  private async attemptReconnect(): Promise<void> {
    const healthy = await this.checkHealthOnPort(this.activePort)
    if (healthy) {
      logger.info(`Reconnected to OpenCode server on port ${this.activePort}`)
      this.isHealthy = true
      this.reconnectAttempts = 0
      this.lastStartupError = null
      return
    }

    const instance = await this.discoverAndConnect()
    if (instance) {
      logger.info(`Found new OpenCode instance on port ${instance.port}`)
      this.activePort = instance.port
      this.version = instance.version
      this.connectedDirectory = instance.directory
      this.isHealthy = true
      this.reconnectAttempts = 0
      this.lastStartupError = null
      opencodeSdkClient.configure(this.activePort)
      return
    }

    this.lastStartupError = `Failed to reconnect after ${this.reconnectAttempts} attempts`
    logger.warn(this.lastStartupError)
  }

  private async tryDiscoverNewInstance(): Promise<void> {
    const instance = await this.discoverAndConnect()
    if (instance) {
      logger.info(`Discovered new OpenCode instance on port ${instance.port}`)
      this.activePort = instance.port
      this.version = instance.version
      this.connectedDirectory = instance.directory
      this.isHealthy = true
      this.reconnectAttempts = 0
      this.lastStartupError = null
      opencodeSdkClient.configure(this.activePort)
    }
  }

  private async checkHealthOnPort(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/doc`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async fetchVersionFromPort(port: number): Promise<string | null> {
    if (opencodeSdkClient.isConfigured() && port === this.activePort) {
      try {
        const version = await opencodeSdkClient.getVersion()
        if (version) {
          this.version = version
          return this.version
        }
      } catch (error) {
        logger.debug('SDK getVersion failed, falling back to direct API:', error)
      }
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        const health = await response.json() as { version?: string }
        if (health.version) {
          this.version = health.version
          return this.version
        }
      }
    } catch (error) {
      logger.debug(`Failed to get version from port ${port}:`, error)
    }
    return await this.fetchVersion()
  }

  private async fetchConnectedDirectoryFromPort(port: number): Promise<string | null> {
    try {
      const projectResponse = await fetch(`http://127.0.0.1:${port}/project/current`, {
        signal: AbortSignal.timeout(3000)
      })
      if (projectResponse.ok) {
        const project = await projectResponse.json() as { path?: string }
        if (project.path) {
          this.connectedDirectory = project.path
          return this.connectedDirectory
        }
      }
    } catch {
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/session`, {
        signal: AbortSignal.timeout(5000)
      })
      if (response.ok) {
        const sessions = await response.json() as Array<{ directory?: string }>
        if (sessions.length > 0 && sessions[0]?.directory) {
          this.connectedDirectory = sessions[0].directory
          return this.connectedDirectory
        }
      }
    } catch (error) {
      logger.warn('Failed to get OpenCode server directory:', error)
    }
    return null
  }

  getDiscoveredInstances(): OpenCodeInstance[] {
    return openCodeDiscoveryService.getInstances()
  }

  async getAllProjects(): Promise<Array<{ path: string; name: string }>> {
    return openCodeDiscoveryService.getAllProjects()
  }

  getActivePort(): number {
    return this.activePort
  }

  async fetchProjectsFromAPI(): Promise<Array<{ path: string; name: string; sandboxes?: string[] }>> {
    if (!this.isHealthy) {
      return []
    }

    if (opencodeSdkClient.isConfigured()) {
      try {
        const projects = await opencodeSdkClient.listProjects()
        return projects.map(p => ({
          path: p.path,
          name: p.name
        }))
      } catch (error) {
        logger.warn('SDK client failed, falling back to direct API call:', error)
      }
    }

    try {
      const response = await fetch(`http://127.0.0.1:${this.activePort}/project`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) {
        return []
      }

      const projects = await response.json() as Array<{
        id: string
        worktree: string
        vcs?: string
        sandboxes?: string[]
      }>

      const result: Array<{ path: string; name: string; sandboxes?: string[] }> = []
      for (const project of projects) {
        if (project.id === 'global' || !project.worktree || project.worktree === '/') {
          continue
        }

        if (project.worktree.startsWith('/private/tmp/') || project.worktree.startsWith('/tmp/')) {
          continue
        }

        result.push({
          path: project.worktree,
          name: project.worktree.split('/').pop() || project.worktree,
          sandboxes: project.sandboxes
        })

        if (project.sandboxes && project.sandboxes.length > 0) {
          for (const sandbox of project.sandboxes) {
            if (!sandbox.startsWith('/private/tmp/') && !sandbox.startsWith('/tmp/')) {
              result.push({
                path: sandbox,
                name: sandbox.split('/').pop() || sandbox
              })
            }
          }
        }
      }

      return result
    } catch (error) {
      logger.warn('Failed to fetch projects from OpenCode API:', error)
      return []
    }
  }
}

export const opencodeServerManager = OpenCodeServerManager.getInstance()
