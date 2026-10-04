import type { Database } from 'bun:sqlite'
import type { SessionPermissionMode } from '@opencode-manager/shared/schemas'

export function ensureSessionPermissionModesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_permission_modes (
      session_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL
    )
  `)
}

export function getSessionPermissionMode(db: Database, sessionId: string): SessionPermissionMode | null {
  const row = db
    .prepare('SELECT mode FROM session_permission_modes WHERE session_id = ?')
    .get(sessionId) as { mode: SessionPermissionMode } | undefined
  return row ? row.mode : null
}

export function setSessionPermissionMode(db: Database, sessionId: string, mode: SessionPermissionMode): void {
  db.prepare(`
    INSERT INTO session_permission_modes(session_id, mode, updated_at)
    VALUES(?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at
  `).run(sessionId, mode, Date.now())
}

export function insertSessionPermissionModeIfAbsent(db: Database, sessionId: string, mode: SessionPermissionMode): void {
  db.prepare(`
    INSERT OR IGNORE INTO session_permission_modes(session_id, mode, updated_at)
    VALUES(?,?,?)
  `).run(sessionId, mode, Date.now())
}

export function deleteSessionPermissionMode(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM session_permission_modes WHERE session_id = ?').run(sessionId)
}
