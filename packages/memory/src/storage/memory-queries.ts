import type { Database } from 'bun:sqlite'
import type { Memory, MemoryScope, CreateMemoryInput, UpdateMemoryInput, MemorySearchResult } from '../types'
import type { VecService } from './vec-types'

function mapRow(row: {
  id: number
  project_id: string
  scope: string
  content: string
  file_path: string | null
  access_count: number
  last_accessed_at: number | null
  created_at: number
  updated_at: number
}): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope as MemoryScope,
    content: row.content,
    filePath: row.file_path,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type MemoryRow = Parameters<typeof mapRow>[0]

interface Logger {
  log: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export function createMemoryQuery(db: Database, vec: VecService, logger?: Logger) {
  const logError = (context: string, error?: unknown) => {
    if (logger) {
      logger.error(context, error)
    }
  }

  const createInDb = (input: CreateMemoryInput): number => {
    const now = Date.now()
    const result = insertMemory.run(
      input.projectId,
      input.scope,
      input.content,
      input.filePath ?? null,
      now,
      now
    )
    return Number(result.lastInsertRowid)
  }

  const insertMemory = db.prepare(`
    INSERT INTO memories (project_id, scope, content, file_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const trackAccessStmt = db.prepare(`
    UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?
  `)

  return {
    createInDb,

    logError,

    async create(input: CreateMemoryInput, embedding: number[]): Promise<number> {
      const now = Date.now()

      const result = insertMemory.run(
        input.projectId,
        input.scope,
        input.content,
        input.filePath ?? null,
        now,
        now
      )

      const memoryId = Number(result.lastInsertRowid)

      if (vec.available && embedding.length > 0) {
        try {
          await vec.insert(embedding, memoryId, input.projectId)
        } catch (error) {
          logError('Failed to insert embedding for memory', error)
        }
      }

      return memoryId
    },

    update(id: number, input: UpdateMemoryInput): void {
      const updates: string[] = []
      const values: (string | number | null)[] = []

      if (input.content !== undefined) {
        updates.push('content = ?')
        values.push(input.content)
      }
      if (input.scope !== undefined) {
        updates.push('scope = ?')
        values.push(input.scope)
      }

      if (updates.length === 0) return

      updates.push('updated_at = ?')
      values.push(Date.now())
      values.push(id)

      db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    },

    async updateEmbedding(memoryId: number, embedding: number[]): Promise<void> {
      if (!vec.available) return

      await vec.delete(memoryId)

      if (embedding.length > 0) {
        const projectId = db.prepare('SELECT project_id FROM memories WHERE id = ?').get(memoryId) as { project_id: string } | undefined
        if (projectId) {
          await vec.insert(embedding, memoryId, projectId.project_id)
        }
      }
    },

    async delete(id: number): Promise<void> {
      if (vec.available) {
        await vec.delete(id)
      }
      db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    },

    getById(id: number): Memory | undefined {
      const row = db.prepare(`
        SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
        FROM memories WHERE id = ?
      `).get(id) as MemoryRow | undefined

      if (!row) return undefined
      return mapRow(row)
    },

    trackAccess(id: number): void {
      trackAccessStmt.run(Date.now(), id)
    },

    listByProject(
      projectId: string,
      filters?: {
        scope?: MemoryScope
        limit?: number
        offset?: number
      }
    ): Memory[] {
      const conditions: string[] = ['project_id = ?']
      const params: (string | number)[] = [projectId]

      if (filters?.scope) {
        conditions.push('scope = ?')
        params.push(filters.scope)
      }

      const limit = filters?.limit ?? 20
      const offset = filters?.offset ?? 0

      const rows = db.prepare(`
        SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
        FROM memories
        WHERE ${conditions.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as MemoryRow[]

      return rows.map(mapRow)
    },

    listAll(
      filters?: {
        projectId?: string
        scope?: MemoryScope
        limit?: number
        offset?: number
      }
    ): Memory[] {
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (filters?.projectId) {
        conditions.push('project_id = ?')
        params.push(filters.projectId)
      }
      if (filters?.scope) {
        conditions.push('scope = ?')
        params.push(filters.scope)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const limit = filters?.limit ?? 20
      const offset = filters?.offset ?? 0

      const rows = db.prepare(`
        SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
        FROM memories
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as MemoryRow[]

      return rows.map(mapRow)
    },

    async search(
      embedding: number[],
      projectId?: string,
      filters?: {
        scope?: MemoryScope
        limit?: number
      }
    ): Promise<MemorySearchResult[]> {
      if (!vec.available) {
        const basicFilters = projectId
          ? { projectId, scope: filters?.scope, limit: filters?.limit }
          : { scope: filters?.scope, limit: filters?.limit }

        const memories = this.listAll(basicFilters)
        return memories.map(memory => ({ memory, distance: 1.0 }))
      }

      try {
        const vecResults = await vec.search(embedding, projectId, filters?.scope, filters?.limit ?? 10)

        if (vecResults.length === 0) {
          const basicFilters = projectId
            ? { projectId, scope: filters?.scope, limit: filters?.limit }
            : { scope: filters?.scope, limit: filters?.limit }
          const memories = this.listAll(basicFilters)
          return memories.map(memory => ({ memory, distance: 1.0 }))
        }

        const memoryIds = vecResults.map(r => r.memoryId)
        const distanceMap = new Map(vecResults.map(r => [r.memoryId, r.distance]))
        const placeholders = memoryIds.map(() => '?').join(',')

        const rows = db.prepare(`
          SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
          FROM memories
          WHERE id IN (${placeholders})
        `).all(...memoryIds) as MemoryRow[]

        return rows
          .map(row => ({
            memory: mapRow(row),
            distance: distanceMap.get(row.id) ?? 1.0,
          }))
          .sort((a, b) => a.distance - b.distance)
      } catch {
        const basicFilters = projectId
          ? { projectId, scope: filters?.scope, limit: filters?.limit }
          : { scope: filters?.scope, limit: filters?.limit }

        const memories = this.listAll(basicFilters)
        return memories.map(memory => ({ memory, distance: 1.0 }))
      }
    },

    getStats(projectId: string): {
      total: number
      byScope: Record<MemoryScope, number>
    } {
      const scopeRows = db.prepare(`
        SELECT scope, COUNT(*) as count FROM memories WHERE project_id = ? GROUP BY scope
      `).all(projectId) as Array<{ scope: string; count: number }>

      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM memories WHERE project_id = ?
      `).get(projectId) as { count: number }

      const byScope: Record<string, number> = {}

      for (const row of scopeRows) {
        byScope[row.scope] = row.count
      }

      return {
        total: totalResult.count,
        byScope: byScope as Record<MemoryScope, number>,
      }
    },

    async deleteByProject(projectId: string): Promise<void> {
      if (vec.available) {
        await vec.deleteByProject(projectId)
      }
      db.prepare('DELETE FROM memories WHERE project_id = ?').run(projectId)
    },

    countByProject(projectId: string): number {
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM memories WHERE project_id = ?
      `).get(projectId) as { count: number }
      return result.count
    },

    existsByContent(projectId: string, content: string): boolean {
      const result = db.prepare(`
        SELECT 1 FROM memories WHERE project_id = ? AND content = ? LIMIT 1
      `).get(projectId, content)
      return !!result
    },

    getMemoriesWithoutEmbeddings(
      projectId?: string,
      limit: number = 50
    ): Memory[] {
      const embeddingsTableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
      ).get()

      if (!embeddingsTableExists) {
        const conditions: string[] = []
        const params: (string | number)[] = []

        if (projectId) {
          conditions.push('project_id = ?')
          params.push(projectId)
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const rows = db.prepare(`
          SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
          FROM memories
          ${where}
          ORDER BY created_at ASC
          LIMIT ? OFFSET 0
        `).all(...params, limit) as MemoryRow[]

        return rows.map(mapRow)
      }

      const conditions: string[] = ['e.memory_id IS NULL']
      const params: (string | number)[] = []

      if (projectId) {
        conditions.push('m.project_id = ?')
        params.push(projectId)
      }

      const rows = db.prepare(`
        SELECT m.id, m.project_id, m.scope, m.content, m.file_path, m.access_count, m.last_accessed_at, m.created_at, m.updated_at
        FROM memories m
        LEFT JOIN memory_embeddings e ON m.id = e.memory_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY m.created_at ASC
        LIMIT ? OFFSET 0
      `).all(...params, limit) as MemoryRow[]

      return rows.map(mapRow)
    },

    countMemoriesWithoutEmbeddings(projectId?: string): number {
      const embeddingsTableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
      ).get()

      if (!embeddingsTableExists) {
        const conditions: string[] = []
        const params: (string | number)[] = []

        if (projectId) {
          conditions.push('project_id = ?')
          params.push(projectId)
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM memories ${where}
        `).get(...params) as { count: number }

        return result.count
      }

      const conditions: string[] = ['e.memory_id IS NULL']
      const params: (string | number)[] = []

      if (projectId) {
        conditions.push('m.project_id = ?')
        params.push(projectId)
      }

      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM memories m
        LEFT JOIN memory_embeddings e ON m.id = e.memory_id
        WHERE ${conditions.join(' AND ')}
      `).get(...params) as { count: number }

      return result.count
    },

    getByContent(projectId: string, content: string): Memory | undefined {
      const row = db.prepare(`
        SELECT * FROM memories WHERE project_id = ? AND content = ? LIMIT 1
      `).get(projectId, content) as MemoryRow | undefined
      return row ? mapRow(row) : undefined
    },

    async findSimilar(
      embedding: number[],
      projectId: string,
      threshold: number = 0.15,
      limit: number = 5
    ): Promise<Array<{ id: number; content: string; distance: number }>> {
      if (!vec.available) return []

      try {
        const vecResults = await vec.findSimilar(embedding, projectId, threshold, limit)

        if (vecResults.length === 0) return []

        const memoryIds = vecResults.map(r => r.memoryId)
        const distanceMap = new Map(vecResults.map(r => [r.memoryId, r.distance]))
        const placeholders = memoryIds.map(() => '?').join(',')

        const rows = db.prepare(`
          SELECT id, content FROM memories WHERE id IN (${placeholders})
        `).all(...memoryIds) as Array<{ id: number; content: string }>

        return rows
          .map(row => ({
            id: row.id,
            content: row.content,
            distance: distanceMap.get(row.id) ?? 1.0,
          }))
          .sort((a, b) => a.distance - b.distance)
      } catch {
        return []
      }
    },

    async deleteByFilePath(projectId: string, filePath: string): Promise<void> {
      if (vec.available) {
        const rows = db.prepare(
          'SELECT id FROM memories WHERE project_id = ? AND file_path = ?'
        ).all(projectId, filePath) as Array<{ id: number }>
        const ids = rows.map(r => r.id)
        if (ids.length > 0) {
          await vec.deleteByMemoryIds(ids)
        }
      }
      db.prepare('DELETE FROM memories WHERE project_id = ? AND file_path = ?').run(projectId, filePath)
    },
  }
}
