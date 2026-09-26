import { describe, it, expect } from 'vitest'
import { buildPinnedSessionKeys } from './sessionKey'

describe('buildPinnedSessionKeys', () => {
  it('builds a session key for each pin', () => {
    const keys = buildPinnedSessionKeys([{ directory: '/a', sessionId: 's1' }])

    expect(keys.has('/a:s1')).toBe(true)
    expect(keys.size).toBe(1)
  })
})
