import type { Database } from 'bun:sqlite'
import type { 
  Session, 
  SessionStatus, 
  CreateSessionInput,
  RepoMapping,
  SessionDetail,
} from '@opencode-manager/shared'
import * as db from '../db/queries'
import { logger } from '../utils/logger'
import path from 'path'
import { mkdir, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { DockerOrchestrator } from './docker-orchestrator'
import { WorktreeManager } from './worktree-manager'
import { DevcontainerManager } from './devcontainer-manager'
import { ImageBuilder } from './image-builder'
import { CodeServerManager } from './code-server-manager'
import { TraefikManager } from './traefik-manager'
import { getWorkspacesPath, getContainerWorkspacesPath } from '@opencode-manager/shared/config/env'

const WORKSPACES_BASE_PATH = getWorkspacesPath()

export class SessionManager {
  private db: Database
  private dockerOrchestrator: DockerOrchestrator
  private worktreeManager: WorktreeManager
  private devcontainerManager: DevcontainerManager
  private imageBuilder: ImageBuilder
  private codeServerManager: CodeServerManager
  private traefikManager: TraefikManager

  constructor(
    database: Database,
    dockerOrchestrator: DockerOrchestrator,
    worktreeManager?: WorktreeManager,
    devcontainerManager?: DevcontainerManager,
    imageBuilder?: ImageBuilder,
    codeServerManager?: CodeServerManager,
    traefikManager?: TraefikManager
  ) {
    this.db = database
    this.dockerOrchestrator = dockerOrchestrator
    this.worktreeManager = worktreeManager || new WorktreeManager()
    this.devcontainerManager = devcontainerManager || new DevcontainerManager(database)
    this.imageBuilder = imageBuilder || new ImageBuilder()
    this.codeServerManager = codeServerManager || new CodeServerManager()
    this.traefikManager = traefikManager || new TraefikManager()
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const sessionId = randomUUID()
    const sanitizedName = this.sanitizeSessionName(input.name)
    
    const existing = db.getSessionByName(this.db, sanitizedName)
    if (existing) {
      throw new Error(`Session with name '${sanitizedName}' already exists`)
    }

    const sessionPath = path.join(WORKSPACES_BASE_PATH, sanitizedName)
    const templateName = input.devcontainerTemplate || 'minimal'
    const template = await this.devcontainerManager.getTemplate(templateName)
    if (!template) {
      throw new Error(`Devcontainer template not found: ${templateName}`)
    }

    const configHash = this.devcontainerManager.calculateConfigHash(template.config)

    const session: Session = {
      id: sessionId,
      name: sanitizedName,
      repoMappings: [],
      status: 'stopped',
      opencodeContainerId: null,
      dindContainerId: null,
      codeServerContainerId: null,
      internalHostname: `${sanitizedName}.oc`,
      opencodeUrl: `http://${sanitizedName}-opencode.oc:5551`,
      codeServerUrl: `https://${sanitizedName}-code.${process.env.PUBLIC_DOMAIN || 'localhost'}`,
      publicOpencodeUrl: input.enablePublicAccess ? `https://${sanitizedName}.${process.env.PUBLIC_DOMAIN || 'localhost'}` : undefined,
      sessionPath,
      opencodeStatePath: path.join(sessionPath, 'state'),
      dindDataPath: path.join(sessionPath, 'docker'),
      codeServerConfigPath: path.join(sessionPath, 'code-server'),
      devcontainerTemplate: templateName,
      devcontainerConfigHash: configHash,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      metadata: input.metadata || {},
    }

    try {
      await this.createSessionDirectories(session)

      const repoMappings: RepoMapping[] = []
      session.repoMappings = repoMappings
      for (const repoInput of input.repos) {
        const repo = db.getRepoById(this.db, repoInput.repoId)
        if (!repo) {
          throw new Error(`Repo not found: ${repoInput.repoId}`)
        }

        const mapping = await this.worktreeManager.createWorktreeForSession(
          repo,
          sanitizedName,
          repoInput.branch
        )
        repoMappings.push(mapping)
      }

      logger.info(`Session directories created: ${sessionPath}`)
      
      db.createSession(this.db, session)
      logger.info(`Session created in database: ${sessionId}`)
      
      return session
    } catch (error) {
      for (const mapping of session.repoMappings) {
        try {
          await this.worktreeManager.removeWorktree(mapping.repoName, sanitizedName)
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup worktree for ${mapping.repoName}:`, cleanupError)
        }
      }

      try {
        await rm(session.sessionPath, { recursive: true, force: true })
      } catch (cleanupError) {
        logger.warn(`Failed to cleanup session directory:`, cleanupError)
      }

      logger.error(`Failed to create session ${sessionId}:`, error)
      throw error
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return db.getSessionById(this.db, sessionId)
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
    const session = await this.getSession(sessionId)
    if (!session) {
      return null
    }

    const opencodeStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-opencode`)
    const dindStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-dind`)
    const codeServerStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-code`)

    return {
      ...session,
      workspaceHostPath: path.join(getWorkspacesPath(), session.name),
      workspaceContainerPath: path.posix.join(getContainerWorkspacesPath(), session.name),
      containers: {
        opencode: opencodeStatus || undefined,
        dind: dindStatus || undefined,
        codeServer: codeServerStatus || undefined,
      },
      repos: session.repoMappings,
    }
  }

  async getSessionByName(name: string): Promise<Session | null> {
    return db.getSessionByName(this.db, name)
  }

  async listSessions(filters?: { status?: SessionStatus }): Promise<Session[]> {
    if (filters?.status) {
      return db.getSessionsByStatus(this.db, filters.status)
    }
    return db.getAllSessions(this.db)
  }

  async listSessionDetails(filters?: { status?: SessionStatus }): Promise<SessionDetail[]> {
    const sessions = await this.listSessions(filters)
    const details = await Promise.all(
      sessions.map(async (session) => {
        const opencodeStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-opencode`)
        const dindStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-dind`)
        const codeServerStatus = await this.dockerOrchestrator.getContainerStatus(`${session.name}-code`)

        return {
          ...session,
          workspaceHostPath: path.join(getWorkspacesPath(), session.name),
          workspaceContainerPath: path.posix.join(getContainerWorkspacesPath(), session.name),
          containers: {
            opencode: opencodeStatus || undefined,
            dind: dindStatus || undefined,
            codeServer: codeServerStatus || undefined,
          },
          repos: session.repoMappings,
        }
      })
    )

    return details
  }

  async setPublicAccess(sessionId: string, enabled: boolean): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) {
      return null
    }

    const publicDomain = process.env.PUBLIC_DOMAIN || 'localhost'
    const url = enabled ? `https://${session.name}.${publicDomain}` : null
    db.updateSessionPublicOpencodeUrl(this.db, sessionId, url)

    const updated = await this.getSession(sessionId)
    if (updated) {
      await this.traefikManager.syncRoutes(await this.listSessions())
    }

    return updated
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    db.updateSessionStatus(this.db, sessionId, status)
    logger.info(`Session ${sessionId} status updated to ${status}`)
  }

  async updateSessionMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    db.updateSessionMetadata(this.db, sessionId, metadata)
  }

  async startSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.status === 'running') {
      logger.info(`Session ${sessionId} is already running`)
      return
    }

    logger.info(`Starting session: ${sessionId}`)
    
    try {
      await this.traefikManager.ensureTraefik()
      const template = await this.devcontainerManager.getTemplate(session.devcontainerTemplate)
      if (!template) {
        throw new Error(`Devcontainer template not found: ${session.devcontainerTemplate}`)
      }

      const configHash = this.devcontainerManager.calculateConfigHash(template.config)
      if (configHash !== session.devcontainerConfigHash) {
        db.updateSessionDevcontainerConfigHash(this.db, sessionId, configHash)
        session.devcontainerConfigHash = configHash
      }

      const nixPackages = template.config.build.args.NIX_PACKAGES || 'git'

      await this.updateSessionStatus(sessionId, 'building')

      db.endTemplateUsageForSession(this.db, sessionId)

      await this.codeServerManager.prepareSession(session, template)

      const imageId = await this.imageBuilder.ensureImage(
        session.devcontainerTemplate,
        configHash,
        template.config
      )

      const composeConfig = {
        sessionName: session.name,
        sessionPath: session.sessionPath,
        nixPackages,
        configHash,
        publicDomain: process.env.PUBLIC_DOMAIN || 'localhost',
        devcontainerTemplate: session.devcontainerTemplate,
        imageId,
      }

      await this.dockerOrchestrator.createSessionPod(composeConfig)

      await this.dockerOrchestrator.waitForContainersHealthy(
        [
          `${session.name}-dind`,
          `${session.name}-opencode`,
          `${session.name}-code`,
        ],
        { timeoutMs: 120000 }
      )
      
      const opencodeId = await this.dockerOrchestrator.getContainerId(`${session.name}-opencode`)
      const dindId = await this.dockerOrchestrator.getContainerId(`${session.name}-dind`)
      const codeServerId = await this.dockerOrchestrator.getContainerId(`${session.name}-code`)

      db.updateSessionContainerIds(this.db, sessionId, {
        opencode: opencodeId || undefined,
        dind: dindId || undefined,
        codeServer: codeServerId || undefined,
      })

      db.createTemplateUsage(this.db, session.devcontainerTemplate, sessionId)

      await this.updateSessionStatus(sessionId, 'running')
      await this.traefikManager.syncRoutes(await this.listSessions())
      logger.info(`Session ${sessionId} started successfully`)
    } catch (error) {
      await this.updateSessionStatus(sessionId, 'error')
      logger.error(`Failed to start session ${sessionId}:`, error)
      throw error
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    logger.info(`Stopping session: ${sessionId}`)
    
    try {
      await this.dockerOrchestrator.stopSessionPod(session.name, session.sessionPath)
      db.endTemplateUsageForSession(this.db, sessionId)
      await this.updateSessionStatus(sessionId, 'stopped')
      await this.traefikManager.syncRoutes(await this.listSessions())
      logger.info(`Session ${sessionId} stopped successfully`)
    } catch (error) {
      logger.error(`Failed to stop session ${sessionId}:`, error)
      throw error
    }
  }

  async restartSession(sessionId: string): Promise<void> {
    logger.info(`Restarting session: ${sessionId}`)
    await this.stopSession(sessionId)
    await new Promise(resolve => setTimeout(resolve, 2000))
    await this.startSession(sessionId)
  }

  async deleteSession(sessionId: string, keepWorktrees: boolean = false): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    logger.info(`Deleting session: ${sessionId}, keepWorktrees: ${keepWorktrees}`)
    
    try {
      await this.dockerOrchestrator.destroySessionPod(session.name, session.sessionPath)
    } catch (error) {
      logger.warn(`Failed to destroy session pod (may not exist):`, error)
    }

    if (!keepWorktrees) {
      for (const mapping of session.repoMappings) {
        logger.info(`Removing worktree: ${mapping.worktreePath}`)
        await this.worktreeManager.removeWorktree(mapping.repoName, session.name)
      }
    }

    try {
      await rm(session.sessionPath, { recursive: true, force: true })
      logger.info(`Removed session directory: ${session.sessionPath}`)
    } catch (error) {
      logger.warn(`Failed to remove session directory:`, error)
    }

    db.endTemplateUsageForSession(this.db, sessionId)
    await this.traefikManager.syncRoutes(await this.listSessions())
    
    db.deleteSession(this.db, sessionId)
    
    logger.info(`Session ${sessionId} deleted from database`)
  }

  private async createSessionDirectories(session: Session): Promise<void> {
    await mkdir(session.sessionPath, { recursive: true })
    await mkdir(session.opencodeStatePath, { recursive: true })
    await mkdir(session.dindDataPath, { recursive: true })
    await mkdir(session.codeServerConfigPath, { recursive: true })
    await mkdir(path.join(session.sessionPath, 'shared'), { recursive: true })
    await mkdir(path.join(session.sessionPath, '.devcontainers'), { recursive: true })
    
    logger.info(`Created session directories at ${session.sessionPath}`)
  }

  private sanitizeSessionName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63)
  }
}
