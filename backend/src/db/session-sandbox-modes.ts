import type { Database } from 'bun:sqlite'
import type { SessionSandboxResources, SessionSandboxSource } from '@opencode-manager/shared/schemas'

export interface SessionSandboxModeRow {
  sandboxed: boolean
  source: SessionSandboxSource
  toggledAt: number
  resources: SessionSandboxResources | null
}

interface SessionSandboxModeRawRow {
  sandboxed: number
  source: SessionSandboxSource
  toggled_at: number
  cpus: number | null
  memory_mib: number | null
}

export function ensureSessionSandboxModesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_sandbox_modes (
      session_id TEXT PRIMARY KEY,
      sandboxed INTEGER NOT NULL CHECK(sandboxed IN (0,1)),
      source TEXT NOT NULL CHECK(source IN ('default','user')),
      toggled_at INTEGER NOT NULL,
      cpus INTEGER CHECK(cpus IS NULL OR cpus > 0),
      memory_mib INTEGER CHECK(memory_mib IS NULL OR memory_mib > 0),
      updated_at INTEGER NOT NULL
    )
  `)
}

export function getSessionSandboxMode(db: Database, sessionId: string): SessionSandboxModeRow | null {
  const row = db
    .prepare('SELECT sandboxed, source, toggled_at, cpus, memory_mib FROM session_sandbox_modes WHERE session_id = ?')
    .get(sessionId) as SessionSandboxModeRawRow | undefined
  if (!row) return null
  return {
    sandboxed: row.sandboxed === 1,
    source: row.source,
    toggledAt: row.toggled_at,
    resources: row.cpus !== null && row.memory_mib !== null
      ? { cpus: row.cpus, memoryMib: row.memory_mib }
      : null,
  }
}

export function insertSessionSandboxModeIfAbsent(
  db: Database,
  sessionId: string,
  mode: { sandboxed: boolean; source: SessionSandboxSource; resources: SessionSandboxResources | null },
): void {
  const now = Date.now()
  db.prepare(`
    INSERT OR IGNORE INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, cpus, memory_mib, updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(
    sessionId,
    mode.sandboxed ? 1 : 0,
    mode.source,
    now,
    mode.resources?.cpus ?? null,
    mode.resources?.memoryMib ?? null,
    now,
  )
}

export function setSessionSandboxed(db: Database, sessionId: string, sandboxed: boolean): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, cpus, memory_mib, updated_at)
    VALUES(?,?,'user',?,NULL,NULL,?)
    ON CONFLICT(session_id) DO UPDATE SET
      sandboxed=excluded.sandboxed,
      source='user',
      toggled_at=excluded.toggled_at,
      updated_at=excluded.updated_at
  `).run(sessionId, sandboxed ? 1 : 0, now, now)
}

export function setSessionSandboxResources(
  db: Database,
  sessionId: string,
  resources: SessionSandboxResources | null,
  defaultSandboxed: boolean,
): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO session_sandbox_modes(session_id, sandboxed, source, toggled_at, cpus, memory_mib, updated_at)
    VALUES(?,?,'default',?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      cpus=excluded.cpus,
      memory_mib=excluded.memory_mib,
      updated_at=excluded.updated_at
  `).run(
    sessionId,
    defaultSandboxed ? 1 : 0,
    now,
    resources?.cpus ?? null,
    resources?.memoryMib ?? null,
    now,
  )
}

export function deleteSessionSandboxMode(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM session_sandbox_modes WHERE session_id = ?').run(sessionId)
}
