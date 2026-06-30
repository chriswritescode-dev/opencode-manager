import { Database } from 'bun:sqlite'

export interface SessionPinRecord {
  sessionId: string
  directory: string
  pinnedAt: number
}

export function ensureSessionPinsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS session_pins (
      session_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      pinned_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, directory)
    )
  `)
}

export function listSessionPins(db: Database): SessionPinRecord[] {
  ensureSessionPinsTable(db)
  const rows = db
    .prepare('SELECT session_id, directory, pinned_at FROM session_pins ORDER BY pinned_at DESC')
    .all() as { session_id: string; directory: string; pinned_at: number }[]
  return rows.map(r => ({ sessionId: r.session_id, directory: r.directory, pinnedAt: r.pinned_at }))
}

export function setSessionPin(
  db: Database,
  sessionId: string,
  directory: string,
  pinned: boolean,
): SessionPinRecord[] {
  const run = db.transaction(() => {
    if (pinned) {
      db.prepare(`
        INSERT INTO session_pins(session_id, directory, pinned_at)
        VALUES(?,?,?)
        ON CONFLICT(session_id, directory) DO UPDATE SET pinned_at=excluded.pinned_at
      `).run(sessionId, directory, Date.now())
    } else {
      db.prepare('DELETE FROM session_pins WHERE session_id = ? AND directory = ?').run(sessionId, directory)
    }
    return listSessionPins(db)
  })
  return run()
}
