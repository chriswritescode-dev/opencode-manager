import type { Database } from 'bun:sqlite'

/** Reports whether a Better Auth session row still exists and has not expired. */
export function isAuthSessionActive(db: Database, sessionId: string, now: number = Date.now()): boolean {
  const row = db
    .prepare('SELECT expiresAt FROM "session" WHERE id = ?')
    .get(sessionId) as { expiresAt: string | number } | null

  if (!row) return false

  const expiresAt = typeof row.expiresAt === 'number' ? row.expiresAt : Date.parse(row.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt > now
}
