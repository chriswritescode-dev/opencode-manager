import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from './migration-runner'
import { allMigrations } from './migrations'
import { listSessionPins, setSessionPin, ensureSessionPinsTable } from './session-pins'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('session-pins', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  describe('listSessionPins', () => {
    it('returns [] on a fresh db', () => {
      expect(listSessionPins(db)).toEqual([])
    })
  })

  describe('setSessionPin', () => {
    it('pinning returns array with the pin', () => {
      const pins = setSessionPin(db, 'ses_1', '/w/a', true)
      expect(pins).toHaveLength(1)
      expect(pins[0]!.sessionId).toBe('ses_1')
      expect(pins[0]!.directory).toBe('/w/a')
      expect(pins[0]!.pinnedAt).toEqual(expect.any(Number))
    })

    it('pinning the same (sessionId, directory) twice does not create a duplicate', async () => {
      setSessionPin(db, 'ses_1', '/w/a', true)
      const first = listSessionPins(db)
      const firstPinnedAt = first[0]!.pinnedAt

      // Delay to guarantee a different pinnedAt timestamp
      await new Promise(r => setTimeout(r, 5))
      const second = setSessionPin(db, 'ses_1', '/w/a', true)
      expect(second).toHaveLength(1)
      expect(second[0]!.pinnedAt).toBeGreaterThan(firstPinnedAt)
    })

    it('same sessionId with different directory produces two distinct pins', () => {
      setSessionPin(db, 'ses_1', '/w/a', true)
      const pins = setSessionPin(db, 'ses_1', '/w/b', true)
      expect(pins).toHaveLength(2)
      expect(pins.map(p => p.directory).sort()).toEqual(['/w/a', '/w/b'])
    })

    it('unpinning removes only that pin', () => {
      setSessionPin(db, 'ses_1', '/w/a', true)
      setSessionPin(db, 'ses_1', '/w/b', true)

      const afterUnpin = setSessionPin(db, 'ses_1', '/w/a', false)
      expect(afterUnpin).toHaveLength(1)
      expect(afterUnpin[0]!.directory).toBe('/w/b')
    })
  })

  describe('ensureSessionPinsTable', () => {
    it('recreates the table if dropped', () => {
      db.run('DROP TABLE session_pins')

      ensureSessionPinsTable(db)
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_pins'")
        .get() as { name: string } | undefined

      expect(table).toBeTruthy()
      expect(table!.name).toBe('session_pins')
    })
  })
})
