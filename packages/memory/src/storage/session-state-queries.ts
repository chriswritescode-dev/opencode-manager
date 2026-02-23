import type { Database } from 'bun:sqlite'

export interface SessionStateRow {
  key: string
  project_id: string
  data: string
  expires_at: number | null
  created_at: number
  updated_at: number
}

function mapRow(row: {
  key: string
  project_id: string
  data: string
  expires_at: number | null
  created_at: number
  updated_at: number
}): SessionStateRow {
  return row
}

type SessionStateRowRaw = Parameters<typeof mapRow>[0]

export function createSessionStateQueries(db: Database) {
  const getStmt = db.prepare(
    `SELECT key, project_id, data, expires_at, created_at, updated_at 
     FROM session_state 
     WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`
  )

  const setStmt = db.prepare(
    `INSERT INTO session_state (key, project_id, data, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       data = excluded.data,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  )

  const deleteStmt = db.prepare(`DELETE FROM session_state WHERE key = ?`)

  const deleteByPrefixStmt = db.prepare(
    `DELETE FROM session_state WHERE key LIKE ?`
  )

  const deleteExpiredStmt = db.prepare(
    `DELETE FROM session_state WHERE expires_at IS NOT NULL AND expires_at < ?`
  )

  const listByProjectStmt = db.prepare(
    `SELECT key, project_id, data, expires_at, created_at, updated_at 
     FROM session_state 
     WHERE project_id = ? AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY updated_at DESC`
  )

  return {
    get(key: string): SessionStateRow | undefined {
      const now = Date.now()
      const row = getStmt.get(key, now) as SessionStateRowRaw | null
      return row ? mapRow(row) : undefined
    },

    set(key: string, projectId: string, data: string, expiresAt: number | null): void {
      const now = Date.now()
      setStmt.run(key, projectId, data, expiresAt, now, now)
    },

    delete(key: string): void {
      deleteStmt.run(key)
    },

    deleteByPrefix(prefix: string): void {
      const pattern = prefix.endsWith('*') ? prefix.slice(0, -1) + '%' : `${prefix}%`
      deleteByPrefixStmt.run(pattern)
    },

    deleteExpired(): number {
      const now = Date.now()
      const result = deleteExpiredStmt.run(now)
      return result.changes
    },

    listByProject(projectId: string): SessionStateRow[] {
      const now = Date.now()
      const rows = listByProjectStmt.all(projectId, now) as SessionStateRowRaw[]
      return rows.map(mapRow)
    },
  }
}
