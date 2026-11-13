import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { selectRow } from './rows'

const AuthSessionRowSchema = z.object({
  expiresAt: z.union([z.number(), z.string().transform((value) => Date.parse(value))]),
})

export function isAuthSessionActive(db: Database, sessionId: string, now: number = Date.now()): boolean {
  const row = selectRow(db, AuthSessionRowSchema, 'SELECT expiresAt FROM "session" WHERE id = ?', sessionId)

  if (!row) return false

  return Number.isFinite(row.expiresAt) && row.expiresAt > now
}
