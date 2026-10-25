import type { Database } from 'bun:sqlite'
import { decryptSecret, encryptSecret } from '../utils/crypto'
import { logger } from '../utils/logger'

export function readEncryptedSecret(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return null

  try {
    return decryptSecret(row.value)
  } catch (error) {
    logger.error(`Failed to decrypt ${key}`, error)
    return null
  }
}

export function writeEncryptedSecret(db: Database, key: string, value: string): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, encryptSecret(value), now, now)
}

export function deleteSecret(db: Database, key: string): void {
  db.prepare('DELETE FROM app_secrets WHERE key = ?').run(key)
}

export function hasSecret(db: Database, key: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM app_secrets WHERE key = ?').get(key))
}
