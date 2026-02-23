import type { Database } from 'bun:sqlite'

export interface PluginMetadata {
  key: string
  value: string
  updatedAt: number
}

export function createMetadataQuery(db: Database) {
  const getStmt = db.prepare('SELECT key, value, updated_at FROM plugin_metadata WHERE key = ?')
  const setStmt = db.prepare(`
    INSERT INTO plugin_metadata (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  return {
    get(key: string): PluginMetadata | undefined {
      const row = getStmt.get(key) as { key: string; value: string; updated_at: number } | undefined
      if (!row) return undefined
      return {
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at,
      }
    },

    set(key: string, value: string): void {
      setStmt.run(key, value, Date.now())
    },

    getEmbeddingModel(): { model: string; dimensions: number } | undefined {
      const row = this.get('embedding_model')
      if (!row) return undefined
      try {
        return JSON.parse(row.value)
      } catch {
        return undefined
      }
    },

    setEmbeddingModel(model: string, dimensions: number): void {
      this.set('embedding_model', JSON.stringify({ model, dimensions }))
    },
  }
}
