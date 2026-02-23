import { Database } from 'bun:sqlite'
import path from 'path'
import { existsSync } from 'node:fs'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

export interface PluginMemory {
  id: number
  projectId: string
  scope: 'convention' | 'decision' | 'context'
  content: string
  filePath: string | null
  accessCount: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

interface DbMemoryRow {
  id: number
  project_id: string
  scope: string
  content: string
  file_path: string | null
  access_count: number
  last_accessed_at: number | null
  created_at: number
  updated_at: number
}

interface MemoryFilters {
  scope?: 'convention' | 'decision' | 'context'
  content?: string
  limit?: number
  offset?: number
}

function getPluginDbPath(): string {
  return path.join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'memory', 'memory.db')
}

function mapRowToMemory(row: DbMemoryRow): PluginMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope as PluginMemory['scope'],
    content: row.content,
    filePath: row.file_path,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class PluginMemoryService {
  private db: Database | null = null

  getDb(): Database | null {
    if (this.db) return this.db

    const dbPath = getPluginDbPath()

    if (!existsSync(dbPath)) {
      return null
    }

    try {
      this.db = new Database(dbPath)
      this.db.exec('PRAGMA journal_mode = WAL')
      return this.db
    } catch {
      return null
    }
  }

  list(projectId: string, filters?: MemoryFilters): PluginMemory[] {
    const db = this.getDb()
    if (!db) return []

    let sql = 'SELECT * FROM memories WHERE project_id = ?'
    const params: (string | number)[] = [projectId]

    if (filters?.scope) {
      sql += ' AND scope = ?'
      params.push(filters.scope)
    }

    if (filters?.content) {
      sql += ' AND content LIKE ?'
      params.push(`%${filters.content}%`)
    }

    sql += ' ORDER BY updated_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as DbMemoryRow[]
    return rows.map(mapRowToMemory)
  }

  listAll(filters?: { projectId?: string; scope?: string; limit?: number; offset?: number }): PluginMemory[] {
    const db = this.getDb()
    if (!db) return []

    let sql = 'SELECT * FROM memories WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.projectId) {
      sql += ' AND project_id = ?'
      params.push(filters.projectId)
    }

    if (filters?.scope) {
      sql += ' AND scope = ?'
      params.push(filters.scope)
    }

    sql += ' ORDER BY updated_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as DbMemoryRow[]
    return rows.map(mapRowToMemory)
  }

  getById(id: number): PluginMemory | undefined {
    const db = this.getDb()
    if (!db) return undefined

    const stmt = db.prepare('SELECT * FROM memories WHERE id = ?')
    const row = stmt.get(id) as DbMemoryRow | undefined
    return row ? mapRowToMemory(row) : undefined
  }

  create(input: { projectId: string; scope: string; content: string }): number {
    const db = this.getDb()
    if (!db) throw new Error('Plugin database not available')

    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO memories (project_id, scope, content, access_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `)
    const result = stmt.run(input.projectId, input.scope, input.content, now, now)
    return result.lastInsertRowid as number
  }

  update(id: number, input: { content?: string; scope?: string }): void {
    const db = this.getDb()
    if (!db) throw new Error('Plugin database not available')

    const updates: string[] = []
    const params: (string | number)[] = []

    if (input.content !== undefined) {
      updates.push('content = ?')
      params.push(input.content)
    }

    if (input.scope !== undefined) {
      updates.push('scope = ?')
      params.push(input.scope)
    }

    if (updates.length === 0) return

    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    const sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = ?`
    const stmt = db.prepare(sql)
    stmt.run(...params)

    try {
      const deleteEmbeddings = db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?')
      deleteEmbeddings.run(id)
    } catch {
      // table may not exist
    }
  }

  delete(id: number): void {
    const db = this.getDb()
    if (!db) throw new Error('Plugin database not available')

    try {
      const deleteEmbeddings = db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?')
      deleteEmbeddings.run(id)
    } catch {
      // table may not exist
    }

    const stmt = db.prepare('DELETE FROM memories WHERE id = ?')
    stmt.run(id)
  }

  getStats(projectId: string): { projectId: string; total: number; byScope: Record<string, number> } {
    const db = this.getDb()
    if (!db) {
      return { projectId, total: 0, byScope: {} }
    }

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM memories WHERE project_id = ?')
    const totalResult = totalStmt.get(projectId) as { count: number }
    const total = totalResult.count

    const byScopeStmt = db.prepare('SELECT scope, COUNT(*) as count FROM memories WHERE project_id = ? GROUP BY scope')
    const byScopeRows = byScopeStmt.all(projectId) as { scope: string; count: number }[]
    const byScope: Record<string, number> = {}
    for (const row of byScopeRows) {
      byScope[row.scope] = row.count
    }

    return { projectId, total, byScope }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
