import type { Database } from 'bun:sqlite'
import { createSessionStateQueries } from '../storage/session-state-queries'
import type { SessionState, PlanningState, PreCompactionSnapshot } from '../types'

const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60 * 1000
const DEFAULT_SNAPSHOT_TTL = 24 * 60 * 60 * 1000

export class SessionStateService {
  private queries: ReturnType<typeof createSessionStateQueries>
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private logger?: { log: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void }

  constructor(db: Database, logger?: { log: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void }) {
    this.queries = createSessionStateQueries(db)
    this.logger = logger
  }

  get<T>(key: string): T | null {
    const row = this.queries.get(key)
    if (!row) return null
    try {
      return JSON.parse(row.data) as T
    } catch {
      return null
    }
  }

  set<T>(key: string, projectId: string, data: T, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null
    const jsonData = JSON.stringify(data)
    this.queries.set(key, projectId, jsonData, expiresAt)
  }

  delete(key: string): void {
    this.queries.delete(key)
  }

  deleteByPrefix(prefix: string): void {
    this.queries.deleteByPrefix(prefix)
  }

  deleteExpired(): number {
    return this.queries.deleteExpired()
  }

  listByProject(projectId: string): SessionState[] {
    const rows = this.queries.listByProject(projectId)
    return rows.map((row): SessionState => ({
      key: row.key,
      projectId: row.project_id,
      data: JSON.parse(row.data),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  startCleanupInterval(intervalMs: number = 30 * 60 * 1000): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      try {
        const deleted = this.deleteExpired()
        if (deleted > 0 && this.logger) {
          this.logger.log(`Cleaned up ${deleted} expired session state entries`)
        }
      } catch (error) {
        if (this.logger) {
          this.logger.error('Failed to clean up expired session state', error)
        }
      }
    }, intervalMs)
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  destroy(): void {
    this.stopCleanupInterval()
  }

  setPlanningState(sessionId: string, projectId: string, planningState: PlanningState): void {
    const key = `session:${sessionId}`
    this.set(key, projectId, planningState, DEFAULT_SESSION_TTL)
  }

  getPlanningState(sessionId: string): PlanningState | null {
    const key = `session:${sessionId}`
    return this.get<PlanningState>(key)
  }

  setCompactionSnapshot(sessionId: string, projectId: string, snapshot: PreCompactionSnapshot): void {
    const key = `compaction:snapshot:${sessionId}`
    this.set(key, projectId, snapshot, DEFAULT_SNAPSHOT_TTL)
  }

  getCompactionSnapshot(sessionId: string): PreCompactionSnapshot | null {
    const key = `compaction:snapshot:${sessionId}`
    return this.get<PreCompactionSnapshot>(key)
  }
}

export function createSessionStateService(
  db: Database,
  logger?: { log: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void }
): SessionStateService {
  return new SessionStateService(db, logger)
}
