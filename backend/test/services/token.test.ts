import { describe, it, expect, beforeEach } from 'bun:test'
import Database from 'bun:sqlite'
import {
  generateToken,
  hashToken,
  createApiToken,
  validateToken,
  listApiTokens,
  revokeApiToken,
  deleteApiToken,
  hasAnyTokens,
  bootstrapFirstToken,
} from '../../src/services/token'

describe('Token Service', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        comment TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `)
  })

  describe('generateToken', () => {
    it('generates token with correct prefix', () => {
      const token = generateToken()
      expect(token.startsWith('ocm_')).toBe(true)
    })

    it('generates token with correct length', () => {
      const token = generateToken()
      expect(token.length).toBe(4 + 64) // prefix + 32 bytes hex
    })

    it('generates unique tokens', () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken())
      }
      expect(tokens.size).toBe(100)
    })
  })

  describe('hashToken', () => {
    it('produces consistent hash for same input', () => {
      const token = 'ocm_test123'
      expect(hashToken(token)).toBe(hashToken(token))
    })

    it('produces different hashes for different inputs', () => {
      expect(hashToken('ocm_test1')).not.toBe(hashToken('ocm_test2'))
    })

    it('produces 64-character hex hash', () => {
      const hash = hashToken('ocm_test123')
      expect(hash.length).toBe(64)
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
    })
  })

  describe('createApiToken', () => {
    it('creates token and returns both token and record', () => {
      const result = createApiToken(db, 'test token')
      expect(result.token.startsWith('ocm_')).toBe(true)
      expect(result.record.id).toBeGreaterThan(0)
      expect(result.record.comment).toBe('test token')
      expect(result.record.isActive).toBe(true)
    })

    it('stores hashed token not plaintext', () => {
      const result = createApiToken(db, 'test token')
      const stored = db.prepare('SELECT token_hash FROM api_tokens WHERE id = ?').get(result.record.id) as { token_hash: string }
      expect(stored.token_hash).not.toBe(result.token)
      expect(stored.token_hash).toBe(hashToken(result.token))
    })

    it('creates token without comment', () => {
      const result = createApiToken(db)
      expect(result.record.comment).toBeNull()
    })
  })

  describe('validateToken', () => {
    it('validates correct token', () => {
      const { token } = createApiToken(db, 'test')
      const validated = validateToken(db, token)
      expect(validated).not.toBeNull()
      expect(validated?.isActive).toBe(true)
    })

    it('rejects invalid token', () => {
      createApiToken(db, 'test')
      const validated = validateToken(db, 'ocm_invalid')
      expect(validated).toBeNull()
    })

    it('rejects token without prefix', () => {
      const validated = validateToken(db, 'invalid_no_prefix')
      expect(validated).toBeNull()
    })

    it('rejects revoked token', () => {
      const { token, record } = createApiToken(db, 'test')
      revokeApiToken(db, record.id)
      const validated = validateToken(db, token)
      expect(validated).toBeNull()
    })

    it('updates last_used_at on validation', async () => {
      const { token, record } = createApiToken(db, 'test')
      expect(record.lastUsedAt).toBeNull()
      
      await new Promise(resolve => setTimeout(resolve, 10))
      validateToken(db, token)
      
      const updated = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(record.id) as { last_used_at: number }
      expect(updated.last_used_at).toBeGreaterThan(record.createdAt)
    })
  })

  describe('listApiTokens', () => {
    it('returns empty array when no tokens', () => {
      const tokens = listApiTokens(db)
      expect(tokens).toEqual([])
    })

    it('returns all tokens ordered by created_at desc', async () => {
      createApiToken(db, 'first')
      await new Promise(resolve => setTimeout(resolve, 10))
      createApiToken(db, 'second')
      
      const tokens = listApiTokens(db)
      expect(tokens.length).toBe(2)
      expect(tokens[0].comment).toBe('second')
      expect(tokens[1].comment).toBe('first')
    })
  })

  describe('revokeApiToken', () => {
    it('revokes existing token', () => {
      const { record } = createApiToken(db, 'test')
      const result = revokeApiToken(db, record.id)
      expect(result).toBe(true)
      
      const updated = db.prepare('SELECT is_active FROM api_tokens WHERE id = ?').get(record.id) as { is_active: number }
      expect(updated.is_active).toBe(0)
    })

    it('returns false for non-existent token', () => {
      const result = revokeApiToken(db, 999)
      expect(result).toBe(false)
    })
  })

  describe('deleteApiToken', () => {
    it('deletes existing token', () => {
      const { record } = createApiToken(db, 'test')
      const result = deleteApiToken(db, record.id)
      expect(result).toBe(true)
      
      const deleted = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(record.id)
      expect(deleted).toBeNull()
    })

    it('returns false for non-existent token', () => {
      const result = deleteApiToken(db, 999)
      expect(result).toBe(false)
    })
  })

  describe('hasAnyTokens', () => {
    it('returns false when no tokens exist', () => {
      expect(hasAnyTokens(db)).toBe(false)
    })

    it('returns true when active tokens exist', () => {
      createApiToken(db, 'test')
      expect(hasAnyTokens(db)).toBe(true)
    })

    it('returns false when only revoked tokens exist', () => {
      const { record } = createApiToken(db, 'test')
      revokeApiToken(db, record.id)
      expect(hasAnyTokens(db)).toBe(false)
    })
  })

  describe('bootstrapFirstToken', () => {
    it('creates token when none exist', () => {
      const token = bootstrapFirstToken(db)
      expect(token).not.toBeNull()
      expect(token?.startsWith('ocm_')).toBe(true)
    })

    it('returns null when tokens already exist', () => {
      createApiToken(db, 'existing')
      const token = bootstrapFirstToken(db)
      expect(token).toBeNull()
    })

    it('creates token with bootstrap comment', () => {
      bootstrapFirstToken(db)
      const tokens = listApiTokens(db)
      expect(tokens[0].comment).toBe('Initial bootstrap token')
    })
  })
})
