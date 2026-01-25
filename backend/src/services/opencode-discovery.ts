import { execSync } from 'child_process'
import { logger } from '../utils/logger'
import { EventEmitter } from 'events'

export interface OpenCodeInstance {
  port: number
  pid: number
  directory: string | null
  version: string | null
  healthy: boolean
  sessions: SessionInfo[]
}

export interface SessionInfo {
  id: string
  title: string
  directory: string
  createdAt: string
  updatedAt: string
}

export interface ProjectInfo {
  path: string
  name: string
  sandboxes?: string[]
}

class OpenCodeDiscoveryService extends EventEmitter {
  private static instance: OpenCodeDiscoveryService
  private instances: Map<number, OpenCodeInstance> = new Map()
  private healthCheckInterval: NodeJS.Timeout | null = null
  private reconnectAttempts: Map<number, number> = new Map()
  private readonly MAX_RECONNECT_ATTEMPTS = 10
  private readonly BASE_RECONNECT_DELAY = 1000
  private readonly HEALTH_CHECK_INTERVAL = 5000

  private constructor() {
    super()
  }

  static getInstance(): OpenCodeDiscoveryService {
    if (!OpenCodeDiscoveryService.instance) {
      OpenCodeDiscoveryService.instance = new OpenCodeDiscoveryService()
    }
    return OpenCodeDiscoveryService.instance
  }

  async discoverInstances(): Promise<OpenCodeInstance[]> {
    const ports = await this.findOpencodePorts()
    const newInstances: OpenCodeInstance[] = []

    for (const { port, pid } of ports) {
      try {
        const healthy = await this.checkHealth(port)
        if (healthy) {
          const existingInstance = this.instances.get(port)
          if (!existingInstance || !existingInstance.healthy) {
            const instance = await this.getInstanceInfo(port, pid)
            this.instances.set(port, instance)
            newInstances.push(instance)
            this.reconnectAttempts.delete(port)
            logger.info(`Discovered OpenCode instance on port ${port} (dir: ${instance.directory || 'unknown'})`)
            this.emit('instance.discovered', instance)
          }
        }
      } catch (error) {
        logger.debug(`Failed to connect to potential OpenCode on port ${port}:`, error)
      }
    }

    for (const [port, instance] of this.instances) {
      if (!ports.find(p => p.port === port)) {
        this.instances.delete(port)
        logger.info(`OpenCode instance on port ${port} is no longer available`)
        this.emit('instance.lost', instance)
      }
    }

    return Array.from(this.instances.values())
  }

  private async findOpencodePorts(): Promise<Array<{ port: number; pid: number }>> {
    try {
      const output = execSync(
        `lsof -i -P -n | grep -E "opencode.*LISTEN" | awk '{print $2, $9}'`,
        { encoding: 'utf8', timeout: 5000 }
      )
      
      const results: Array<{ port: number; pid: number }> = []
      const lines = output.trim().split('\n').filter(Boolean)
      
      for (const line of lines) {
        const [pidStr, address] = line.split(' ')
        if (!pidStr || !address) continue
        const pid = parseInt(pidStr)
        const portMatch = address.match(/:(\d+)$/)
        if (portMatch && portMatch[1] && pid) {
          const port = parseInt(portMatch[1])
          if (!results.find(r => r.port === port)) {
            results.push({ port, pid })
          }
        }
      }
      
      return results
    } catch (error) {
      logger.debug('Failed to find OpenCode ports via lsof:', error)
      return []
    }
  }

  private async checkHealth(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/doc`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async getInstanceInfo(port: number, pid: number): Promise<OpenCodeInstance> {
    let version: string | null = null
    let directory: string | null = null
    let sessions: SessionInfo[] = []

    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/global/health`, {
        signal: AbortSignal.timeout(3000)
      })
      if (healthResponse.ok) {
        const health = await healthResponse.json() as { version?: string }
        version = health.version || null
      }
    } catch (error) {
      logger.debug(`Failed to get version from port ${port}:`, error)
    }

    try {
      const projectResponse = await fetch(`http://127.0.0.1:${port}/project/current`, {
        signal: AbortSignal.timeout(3000)
      })
      if (projectResponse.ok) {
        const project = await projectResponse.json() as { path?: string }
        directory = project.path || null
      }
    } catch (error) {
      logger.debug(`Failed to get current project from port ${port}:`, error)
    }

    try {
      const sessionsResponse = await fetch(`http://127.0.0.1:${port}/session`, {
        signal: AbortSignal.timeout(5000)
      })
      if (sessionsResponse.ok) {
        const sessionsData = await sessionsResponse.json() as Array<{
          id: string
          title?: string
          directory?: string
          createdAt?: string
          updatedAt?: string
        }>
        sessions = sessionsData.map(s => ({
          id: s.id,
          title: s.title || 'Untitled',
          directory: s.directory || directory || '',
          createdAt: s.createdAt || new Date().toISOString(),
          updatedAt: s.updatedAt || new Date().toISOString()
        }))

        if (!directory && sessions.length > 0) {
          const firstSession = sessions[0]
          if (firstSession && firstSession.directory) {
            directory = firstSession.directory
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to get sessions from port ${port}:`, error)
    }

    return {
      port,
      pid,
      directory,
      version,
      healthy: true,
      sessions
    }
  }

  async getAllProjects(): Promise<ProjectInfo[]> {
    const projects: Map<string, ProjectInfo> = new Map()

    for (const instance of this.instances.values()) {
      if (instance.directory) {
        projects.set(instance.directory, {
          path: instance.directory,
          name: instance.directory.split('/').pop() || instance.directory
        })
      }

      for (const session of instance.sessions) {
        if (session.directory && !projects.has(session.directory)) {
          projects.set(session.directory, {
            path: session.directory,
            name: session.directory.split('/').pop() || session.directory
          })
        }
      }
    }

    return Array.from(projects.values())
  }

  getInstances(): OpenCodeInstance[] {
    return Array.from(this.instances.values())
  }

  getInstanceByPort(port: number): OpenCodeInstance | undefined {
    return this.instances.get(port)
  }

  getInstanceByDirectory(directory: string): OpenCodeInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.directory === directory) {
        return instance
      }
      for (const session of instance.sessions) {
        if (session.directory === directory) {
          return instance
        }
      }
    }
    return undefined
  }

  getPrimaryInstance(): OpenCodeInstance | undefined {
    const instances = Array.from(this.instances.values())
    return instances.find(i => i.healthy) || instances[0]
  }

  startHealthMonitor(): void {
    if (this.healthCheckInterval) {
      return
    }

    logger.info('Starting OpenCode instance health monitor')
    
    this.discoverInstances().catch(err => {
      logger.error('Initial instance discovery failed:', err)
    })

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.discoverInstances()
      } catch (error) {
        logger.error('Health check failed:', error)
      }
    }, this.HEALTH_CHECK_INTERVAL)
  }

  stopHealthMonitor(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
      logger.info('Stopped OpenCode instance health monitor')
    }
  }

  async waitForAnyInstance(timeoutMs: number = 30000): Promise<OpenCodeInstance | null> {
    const start = Date.now()
    
    while (Date.now() - start < timeoutMs) {
      await this.discoverInstances()
      const instance = this.getPrimaryInstance()
      if (instance) {
        return instance
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    
    return null
  }

  async fetchProjectsFromOpenCode(port: number): Promise<ProjectInfo[]> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/project`, {
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

      const result: ProjectInfo[] = []
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
      logger.debug(`Failed to fetch projects from port ${port}:`, error)
      return []
    }
  }

  async getAllProjectsFromOpenCode(): Promise<ProjectInfo[]> {
    await this.discoverInstances()
    const instance = this.getPrimaryInstance()
    if (!instance) {
      return []
    }
    return this.fetchProjectsFromOpenCode(instance.port)
  }
}

export const openCodeDiscoveryService = OpenCodeDiscoveryService.getInstance()
