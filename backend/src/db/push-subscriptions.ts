import type { Database } from 'bun:sqlite'

/** Creates the push subscriptions schema and adds the columns older databases lack. */
export function ensurePushSubscriptionsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_name TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )
  `)

  const columns = db.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'session_id')) {
    db.run('ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT')
  }

  db.run('CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_subscriptions(endpoint)')
  db.run('CREATE INDEX IF NOT EXISTS idx_push_sub_session ON push_subscriptions(session_id)')
}

/** Deletes the push subscriptions registered by any of the given Better Auth sessions. */
export function deletePushSubscriptionsForSessions(db: Database, sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0
  const placeholders = sessionIds.map(() => '?').join(', ')
  return db
    .prepare(`DELETE FROM push_subscriptions WHERE session_id IN (${placeholders})`)
    .run(...sessionIds).changes
}

/** Deletes the push subscriptions a revoked Better Auth session registered. */
export function deletePushSubscriptionsForSession(db: Database, sessionId: string): number {
  return deletePushSubscriptionsForSessions(db, [sessionId])
}
