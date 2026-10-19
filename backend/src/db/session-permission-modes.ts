import type { Database } from 'bun:sqlite'
import { LOCAL_OPENCODE_SERVER_ID, type SessionPermissionMode } from '@opencode-manager/shared/schemas'

export function ensureSessionPermissionModesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_permission_modes (
      session_id TEXT NOT NULL,
      server_id TEXT NOT NULL DEFAULT 'local',
      mode TEXT NOT NULL CHECK(mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, session_id)
    )
  `)
}

export function getSessionPermissionMode(
  db: Database,
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): SessionPermissionMode | null {
  const row = db
    .prepare('SELECT mode FROM session_permission_modes WHERE server_id = ? AND session_id = ?')
    .get(serverId, sessionId) as { mode: SessionPermissionMode } | undefined
  return row ? row.mode : null
}

export function setSessionPermissionMode(
  db: Database,
  sessionId: string,
  mode: SessionPermissionMode,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): void {
  db.prepare(`
    INSERT INTO session_permission_modes(server_id, session_id, mode, updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(server_id, session_id) DO UPDATE SET
      mode=excluded.mode,
      updated_at=excluded.updated_at
  `).run(serverId, sessionId, mode, Date.now())
}

export function insertSessionPermissionModeIfAbsent(
  db: Database,
  sessionId: string,
  mode: SessionPermissionMode,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO session_permission_modes(server_id, session_id, mode, updated_at)
    VALUES(?,?,?,?)
  `).run(serverId, sessionId, mode, Date.now())
}

export function deleteSessionPermissionMode(
  db: Database,
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): void {
  db.prepare('DELETE FROM session_permission_modes WHERE server_id = ? AND session_id = ?').run(serverId, sessionId)
}
