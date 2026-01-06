import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'crypto'
import { logger } from '../utils/logger'

const TOKEN_PREFIX = 'ocm_'
const TOKEN_BYTES = 32

export interface ApiToken {
  id: number
  tokenHash: string
  comment: string | null
  createdAt: number
  lastUsedAt: number | null
  isActive: boolean
}

interface ApiTokenRow {
  id: number
  token_hash: string
  comment: string | null
  created_at: number
  last_used_at: number | null
  is_active: number
}

function rowToToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    comment: row.comment,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    isActive: Boolean(row.is_active),
  }
}

export function generateToken(): string {
  const bytes = randomBytes(TOKEN_BYTES)
  return TOKEN_PREFIX + bytes.toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createApiToken(db: Database, comment?: string): { token: string; record: ApiToken } {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const now = Date.now()

  const stmt = db.prepare(`
    INSERT INTO api_tokens (token_hash, comment, created_at, is_active)
    VALUES (?, ?, ?, 1)
  `)
  
  const result = stmt.run(tokenHash, comment || null, now)
  
  const record = getApiTokenById(db, Number(result.lastInsertRowid))
  if (!record) {
    throw new Error('Failed to retrieve newly created token')
  }
  
  logger.info(`Created new API token: ${comment || 'no comment'} (id: ${record.id})`)
  
  return { token, record }
}

export function getApiTokenById(db: Database, id: number): ApiToken | null {
  const stmt = db.prepare('SELECT * FROM api_tokens WHERE id = ?')
  const row = stmt.get(id) as ApiTokenRow | undefined
  return row ? rowToToken(row) : null
}

export function validateToken(db: Database, token: string): ApiToken | null {
  if (!token.startsWith(TOKEN_PREFIX)) {
    return null
  }
  
  const tokenHash = hashToken(token)
  const stmt = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND is_active = 1')
  const row = stmt.get(tokenHash) as ApiTokenRow | undefined
  
  if (!row) {
    return null
  }
  
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)
  
  return rowToToken(row)
}

export function listApiTokens(db: Database): ApiToken[] {
  const stmt = db.prepare('SELECT * FROM api_tokens ORDER BY created_at DESC')
  const rows = stmt.all() as ApiTokenRow[]
  return rows.map(rowToToken)
}

export function revokeApiToken(db: Database, id: number): boolean {
  const stmt = db.prepare('UPDATE api_tokens SET is_active = 0 WHERE id = ?')
  const result = stmt.run(id)
  
  if (result.changes > 0) {
    logger.info(`Revoked API token id: ${id}`)
    return true
  }
  return false
}

export function deleteApiToken(db: Database, id: number): boolean {
  const stmt = db.prepare('DELETE FROM api_tokens WHERE id = ?')
  const result = stmt.run(id)
  
  if (result.changes > 0) {
    logger.info(`Deleted API token id: ${id}`)
    return true
  }
  return false
}

export function hasAnyTokens(db: Database): boolean {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM api_tokens WHERE is_active = 1')
  const row = stmt.get() as { count: number }
  return row.count > 0
}

export function bootstrapFirstToken(db: Database): string | null {
  if (hasAnyTokens(db)) {
    return null
  }
  
  const { token } = createApiToken(db, 'Initial bootstrap token')
  return token
}
