import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { createTestDatabase } from '../../test/helpers/test-database'
import { selectRow } from './rows'
import { listSessionPins, setSessionPin, ensureSessionPinsTable } from './session-pins'

const TableNameRowSchema = z.object({ name: z.string() })

describe('session-pins', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDatabase()
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
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

    it('pinning the same (sessionId, directory) twice does not create a duplicate', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      setSessionPin(db, 'ses_1', '/w/a', true)
      const firstPinnedAt = listSessionPins(db)[0]!.pinnedAt

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
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
      const table = selectRow(
        db,
        TableNameRowSchema,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_pins'",
      )

      expect(table?.name).toBe('session_pins')
    })
  })
})
