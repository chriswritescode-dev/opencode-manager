import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/client'
import { logger } from '../utils/logger'

export interface ProjectInfo {
  id: string
  path: string
  name: string
  vcs?: string
  createdAt?: number
  updatedAt?: number
}

export interface SessionInfo {
  id: string
  title?: string
  directory?: string
  createdAt?: string
  updatedAt?: string
}

class OpenCodeSDKClient {
  private static instance: OpenCodeSDKClient
  private client: OpencodeClient | null = null
  private baseUrl: string = ''

  private constructor() {}

  static getInstance(): OpenCodeSDKClient {
    if (!OpenCodeSDKClient.instance) {
      OpenCodeSDKClient.instance = new OpenCodeSDKClient()
    }
    return OpenCodeSDKClient.instance
  }

  configure(port: number, host: string = '127.0.0.1'): void {
    this.baseUrl = `http://${host}:${port}`
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
    })
    logger.info(`OpenCode SDK client configured for ${this.baseUrl}`)
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  async listProjects(): Promise<ProjectInfo[]> {
    if (!this.client) {
      logger.warn('OpenCode SDK client not configured')
      return []
    }

    try {
      const response = await this.client.project.list()
      if (!response.data) {
        return []
      }

      const projects: ProjectInfo[] = []
      for (const project of response.data) {
        if (project.id === 'global' || !project.worktree || project.worktree === '/') {
          continue
        }

        if (project.worktree.startsWith('/private/tmp/') || project.worktree.startsWith('/tmp/')) {
          continue
        }

        projects.push({
          id: project.id,
          path: project.worktree,
          name: project.worktree.split('/').pop() || project.worktree,
          vcs: project.vcs || undefined,
          createdAt: project.time?.created,
          updatedAt: project.time?.initialized,
        })
      }

      return projects
    } catch (error) {
      logger.error('Failed to list projects via SDK:', error)
      return []
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.client) {
      logger.warn('OpenCode SDK client not configured')
      return []
    }

    try {
      const response = await this.client.session.list()
      if (!response.data) {
        return []
      }

      return response.data.map(session => ({
        id: session.id,
        title: session.title || undefined,
        directory: session.directory || undefined,
        createdAt: session.time?.created ? new Date(session.time.created).toISOString() : undefined,
        updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : undefined,
      }))
    } catch (error) {
      logger.error('Failed to list sessions via SDK:', error)
      return []
    }
  }

  async getVersion(): Promise<string | null> {
    if (!this.client) {
      return null
    }

    try {
      const response = await fetch(`${this.baseUrl}/global/health`, {
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        const data = await response.json() as { version?: string }
        return data.version || null
      }
    } catch (error) {
      logger.debug('Failed to get version:', error)
    }
    return null
  }

  async checkHealth(): Promise<boolean> {
    if (!this.client) {
      return false
    }

    try {
      const response = await fetch(`${this.baseUrl}/doc`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async getCurrentProject(): Promise<{ path: string } | null> {
    if (!this.client) {
      return null
    }

    try {
      const response = await this.client.project.current()
      if (response.data?.worktree) {
        return { path: response.data.worktree }
      }
    } catch (error) {
      logger.debug('Failed to get current project:', error)
    }
    return null
  }

  async getAllProjectPaths(): Promise<string[]> {
    const projects = await this.listProjects()
    return projects.map(p => p.path)
  }
}

export const opencodeSdkClient = OpenCodeSDKClient.getInstance()
