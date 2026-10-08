import type { Database } from 'bun:sqlite'
import {
  ChangeWalkthroughSchema,
  walkthroughSourceKey,
  type ChangeWalkthrough,
} from '@opencode-manager/shared/schemas'

interface ChangeWalkthroughRow {
  session_id: string
  source_key: string
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

export function getChangeWalkthrough(
  db: Database,
  sessionId: string,
  sourceKey: string,
): ChangeWalkthrough | null {
  const row = db
    .prepare(
      'SELECT session_id, source_key, diff_hash, payload, created_at FROM change_walkthroughs WHERE session_id = ? AND source_key = ?',
    )
    .get(sessionId, sourceKey) as ChangeWalkthroughRow | undefined
  if (!row) {
    return null
  }
  try {
    return ChangeWalkthroughSchema.parse(JSON.parse(row.payload))
  } catch {
    return null
  }
}

export function deleteChangeWalkthroughs(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM change_walkthroughs WHERE session_id = ?').run(sessionId)
}

export function saveChangeWalkthrough(db: Database, walkthrough: ChangeWalkthrough): void {
  const sourceKey = walkthroughSourceKey(walkthrough.source)
  db.prepare(`
    INSERT INTO change_walkthroughs(session_id, source_key, diff_hash, payload, created_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(session_id, source_key) DO UPDATE SET
      diff_hash = excluded.diff_hash,
      payload = excluded.payload,
      created_at = excluded.created_at
  `).run(
    walkthrough.sessionId,
    sourceKey,
    walkthrough.diffHash,
    JSON.stringify(walkthrough),
    walkthrough.createdAt,
  )
}
