import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { getOrCreateInternalToken, rotateInternalToken } from '../../src/services/internal-token'
import migration013 from '../../src/db/migrations/013-app-secrets'

describe('internal-token', () => {
  function createTestDb(): Database {
    const db = new Database(':memory:')
    migration013.up(db)
    return db
  }

  it('getOrCreateInternalToken creates a token on first call and returns it', () => {
    const db = createTestDb()
    const token = getOrCreateInternalToken(db)
    expect(token).toBeDefined()
    expect(token.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(token)).toBe(true)
  })

  it('getOrCreateInternalToken returns the same token on subsequent calls', () => {
    const db = createTestDb()
    const token1 = getOrCreateInternalToken(db)
    const token2 = getOrCreateInternalToken(db)
    expect(token1).toBe(token2)
  })

  it('rotateInternalToken replaces the value', () => {
    const db = createTestDb()
    const token1 = getOrCreateInternalToken(db)
    const token2 = rotateInternalToken(db)
    expect(token1).not.toBe(token2)
    const token3 = getOrCreateInternalToken(db)
    expect(token3).toBe(token2)
  })
})
