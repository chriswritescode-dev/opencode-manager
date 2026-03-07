import type { Database } from 'bun:sqlite'
import type { 
  Session, 
  SessionStatus, 
  CreateSessionInput,
  RepoMapping,
} from '@opencode-manager/shared'
import * as db from '../db/queries'
import { logger } from '../utils/logger'
import path from 'path'
import { mkdir, symlink, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { DockerOrchestrator } from './docker-orchestrator'

const SESSIONS_BASE_PATH = '/workspace/sessions'
const REPOS_BASE_PATH = '/workspace/repos'

export class SessionManager {
  private db: Database
  private dockerOrchestrator: DockerOrchestrator

  constructor(database: Database, dockerOrchestrator: DockerOrchestrator) {
    this.db = database
    this.dockerOrchestrator = dockerOrchestrator
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const sessionId = randomUUID()
    const sanitizedName = this.sanitizeSessionName(input.name)
    
    const existing = db.getSessionByName(this.db, sanitizedName)
    if (existing) {
      throw new Error(`Session with name '${sanitizedName}' already exists`)
    }

    const sessionPath = path.join(SESSIONS_BASE_PATH, sanitizedName)
    const session: Session = {
      id: sessionId,
      name: sanitizedName,
      repoMappings: [],
      status: 'creating',
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
      devcontainerTemplate: input.devcontainerTemplate || 'minimal',
      devcontainerConfigHash: '',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      metadata: input.metadata || {},
    }

    try {
      await this.createSessionDirectories(session)
      
      logger.info(`Session directories created: ${sessionPath}`)
      
      db.createSession(this.db, session)
      logger.info(`Session created in database: ${sessionId}`)
      
      return session
    } catch (error) {
      logger.error(`Failed to create session ${sessionId}:`, error)
      throw error
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return db.getSessionById(this.db, sessionId)
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

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    db.updateSessionStatus(this.db, sessionId, status)
    logger.info(`Session ${sessionId} status updated to ${status}`)
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
      const composeConfig = {
        sessionName: session.name,
        sessionPath: session.sessionPath,
        nixPackages: 'git nodejs_22',
        configHash: session.devcontainerConfigHash,
        publicDomain: process.env.PUBLIC_DOMAIN || 'localhost',
      }

      await this.dockerOrchestrator.createSessionPod(composeConfig)
      
      const opencodeId = await this.dockerOrchestrator.getContainerId(`${session.name}-opencode`)
      const dindId = await this.dockerOrchestrator.getContainerId(`${session.name}-dind`)
      const codeServerId = await this.dockerOrchestrator.getContainerId(`${session.name}-code`)

      db.updateSessionContainerIds(this.db, sessionId, {
        opencode: opencodeId || undefined,
        dind: dindId || undefined,
        codeServer: codeServerId || undefined,
      })

      await this.updateSessionStatus(sessionId, 'running')
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
      await this.updateSessionStatus(sessionId, 'stopped')
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
      }
    }

    try {
      await rm(session.sessionPath, { recursive: true, force: true })
      logger.info(`Removed session directory: ${session.sessionPath}`)
    } catch (error) {
      logger.warn(`Failed to remove session directory:`, error)
    }
    
    db.deleteSession(this.db, sessionId)
    
    logger.info(`Session ${sessionId} deleted from database`)
  }

  private async createSessionDirectories(session: Session): Promise<void> {
    await mkdir(session.sessionPath, { recursive: true })
    await mkdir(session.opencodeStatePath, { recursive: true })
    await mkdir(session.dindDataPath, { recursive: true })
    await mkdir(session.codeServerConfigPath, { recursive: true })
    await mkdir(path.join(session.sessionPath, '.shared'), { recursive: true })
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
