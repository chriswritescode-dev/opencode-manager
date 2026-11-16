import type { Database } from 'bun:sqlite'
import { SessionSandboxSourceSchema, type SessionSandboxSource } from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { selectRow } from './rows'

export interface SessionSandboxModeRow {
  sandboxed: boolean
  source: SessionSandboxSource
  toggledAt: number
}

const SessionSandboxModeRawRowSchema = z.object({
  sandboxed: z.number(),
  source: SessionSandboxSourceSchema,
  toggled_at: z.number(),
})

export function ensureSessionSandboxModesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_sandbox_modes (
      session_id TEXT PRIMARY KEY,
      sandboxed INTEGER NOT NULL CHECK(sandboxed IN (0,1)),
      source TEXT NOT NULL CHECK(source IN ('default','user')),
      toggled_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

export function getSessionSandboxMode(db: Database, sessionId: string): SessionSandboxModeRow | null {
  const row = selectRow(
    db,
    SessionSandboxModeRawRowSchema,
    'SELECT sandboxed, source, toggled_at FROM session_sandbox_modes WHERE session_id = ?',
    sessionId,
  )
  if (!row) return null
  return {
    sandboxed: row.sandboxed === 1,
    source: row.source,
    toggledAt: row.toggled_at,
  }
}

export function insertSessionSandboxModeIfAbsent(
  db: Database,
  sessionId: string,
  mode: { sandboxed: boolean; source: SessionSandboxSource },
): void {
  const now = Date.now()
  db.prepare(`
    INSERT OR IGNORE INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, updated_at)
    VALUES(?,?,?,?,?)
  `).run(
    sessionId,
    mode.sandboxed ? 1 : 0,
    mode.source,
    now,
    now,
  )
}

export function setSessionSandboxed(db: Database, sessionId: string, sandboxed: boolean): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, updated_at)
    VALUES(?,?,'user',?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      sandboxed=excluded.sandboxed,
      source='user',
      toggled_at=excluded.toggled_at,
      updated_at=excluded.updated_at
  `).run(sessionId, sandboxed ? 1 : 0, now, now)
}

export function deleteSessionSandboxMode(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM session_sandbox_modes WHERE session_id = ?').run(sessionId)
}
