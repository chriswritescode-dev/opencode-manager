import type { Database } from 'bun:sqlite'

export function ensureAuthSessionTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY NOT NULL,
      expiresAt INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL
    )
  `)
}

export function insertAuthSession(
  db: Database,
  id: string,
  options: { expiresAt?: number; userId?: string } = {},
): void {
  const timestamp = new Date().toISOString()
  db.prepare(
    'INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    new Date(options.expiresAt ?? Date.now() + 60_000).toISOString(),
    `token-${id}`,
    timestamp,
    timestamp,
    options.userId ?? 'default',
  )
}
