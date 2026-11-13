import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const KEY = 'internal_token'

const tokenRowSchema = z.object({ value: z.string() })

export function getOrCreateInternalToken(db: Database): string {
  const row = tokenRowSchema.safeParse(db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(KEY))
  if (row.success) return row.data.value
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)').run(KEY, token, now, now)
  return token
}

export function rotateInternalToken(db: Database): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(`
    INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(KEY, token, now, now)
  return token
}
