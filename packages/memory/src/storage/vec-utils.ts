import type { Database } from 'bun:sqlite'

export type TableDimensionsResult =
  | { exists: false }
  | { exists: true; dimensions: number | null }

export function getTableDimensions(db: Database): TableDimensionsResult {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
  ).get() as { sql: string } | undefined

  if (!row) return { exists: false }

  const match = row.sql.match(/float\[(\d+)\]/i)
  return { exists: true, dimensions: match ? parseInt(match[1]!, 10) : null }
}

export function recreateVecTable(db: Database, dimensions: number): void {
  db.run('DROP TABLE IF EXISTS memory_embeddings')
  db.run(`
    CREATE VIRTUAL TABLE memory_embeddings USING vec0(
      embedding float[${dimensions}],
      +memory_id INTEGER,
      +project_id TEXT
    )
  `)
}
