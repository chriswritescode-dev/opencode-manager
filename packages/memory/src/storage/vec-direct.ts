import type { Database } from 'bun:sqlite'
import type { VecService, VecSearchResult } from './vec-types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function createDirectVecService(db: Database): VecService {
  let loaded = false

  try {
    const { getLoadablePath } = require('sqlite-vec')
    db.loadExtension(getLoadablePath())
    loaded = true
  } catch {
    loaded = false
  }

  return {
    get available() {
      return loaded
    },

    async initialize(dimensions: number) {
      if (!loaded) return

      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
      ).get()

      if (!exists) {
        db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
            embedding float[${dimensions}],
            +memory_id INTEGER,
            +project_id TEXT
          )
        `)
      }
    },

    async insert(embedding: number[], memoryId: number, projectId: string) {
      if (!loaded) return
      db.prepare(
        'INSERT INTO memory_embeddings (embedding, memory_id, project_id) VALUES (?, ?, ?)'
      ).run(JSON.stringify(embedding), memoryId, projectId)
    },

    async delete(memoryId: number) {
      if (!loaded) return
      db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(memoryId)
    },

    async deleteByProject(projectId: string) {
      if (!loaded) return
      db.prepare('DELETE FROM memory_embeddings WHERE project_id = ?').run(projectId)
    },

    async deleteByMemoryIds(memoryIds: number[]) {
      if (!loaded || memoryIds.length === 0) return
      const placeholders = memoryIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM memory_embeddings WHERE memory_id IN (${placeholders})`).run(...memoryIds)
    },

    async search(embedding: number[], projectId?: string, scope?: string, limit: number = 10): Promise<VecSearchResult[]> {
      if (!loaded) return []

      const embeddingJson = JSON.stringify(embedding)
      const conditions: string[] = []
      const params: (string | number)[] = [embeddingJson]

      if (projectId) {
        conditions.push('e.project_id = ?')
        params.push(projectId)
      }
      if (scope) {
        conditions.push('m.scope = ?')
        params.push(scope)
      }
      params.push(limit)

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db.prepare(`
        SELECT e.memory_id, (e.embedding <=> ?) as distance
        FROM memory_embeddings e
        JOIN memories m ON m.id = e.memory_id
        ${whereClause}
        ORDER BY distance
        LIMIT ?
      `).all(...params) as Array<{ memory_id: number; distance: number }>

      return rows.map(r => ({ memoryId: r.memory_id, distance: r.distance }))
    },

    async findSimilar(embedding: number[], projectId: string, threshold: number, limit: number): Promise<VecSearchResult[]> {
      if (!loaded) return []

      const embeddingJson = JSON.stringify(embedding)
      const rows = db.prepare(`
        SELECT e.memory_id, (e.embedding <=> ?) as distance
        FROM memory_embeddings e
        JOIN memories m ON m.id = e.memory_id
        WHERE m.project_id = ?
          AND (e.embedding <=> ?) < ?
        ORDER BY distance LIMIT ?
      `).all(embeddingJson, projectId, embeddingJson, threshold, limit) as Array<{
        memory_id: number
        distance: number
      }>

      return rows.map(r => ({ memoryId: r.memory_id, distance: r.distance }))
    },

    dispose() {},
  }
}
