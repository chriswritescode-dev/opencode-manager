import type { Database } from 'bun:sqlite'
import { ChangeWalkthroughSchema, type ChangeWalkthrough } from '@opencode-manager/shared/schemas'

interface ChangeWalkthroughRow {
  session_id: string
  diff_hash: string
  payload: string
  created_at: number
}

export function ensureChangeWalkthroughTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS change_walkthroughs (
      session_id TEXT PRIMARY KEY,
      diff_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

export function getChangeWalkthrough(db: Database, sessionId: string): ChangeWalkthrough | null {
  const row = db
    .prepare('SELECT session_id, diff_hash, payload, created_at FROM change_walkthroughs WHERE session_id = ?')
    .get(sessionId) as ChangeWalkthroughRow | undefined
  if (!row) {
    return null
  }
  try {
    return ChangeWalkthroughSchema.parse(JSON.parse(row.payload))
  } catch {
    return null
  }
}

export function saveChangeWalkthrough(db: Database, walkthrough: ChangeWalkthrough): void {
  db.prepare(`
    INSERT INTO change_walkthroughs(session_id, diff_hash, payload, created_at)
    VALUES(?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      diff_hash = excluded.diff_hash,
      payload = excluded.payload,
      created_at = excluded.created_at
  `).run(walkthrough.sessionId, walkthrough.diffHash, JSON.stringify(walkthrough), walkthrough.createdAt)
}
