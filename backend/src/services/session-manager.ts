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
import { mkdir, symlink } from 'fs/promises'
import { randomUUID } from 'crypto'

const SESSIONS_BASE_PATH = '/workspace/sessions'
const REPOS_BASE_PATH = '/workspace/repos'

export class SessionManager {
  private db: Database

  constructor(database: Database) {
    this.db = database
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

  async deleteSession(sessionId: string, keepWorktrees: boolean = false): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    logger.info(`Deleting session: ${sessionId}, keepWorktrees: ${keepWorktrees}`)
    
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
