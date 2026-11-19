import { describe, it, expect } from 'vitest'
import { buildPinnedSessionKeys, getSessionKey } from './sessionKey'

describe('getSessionKey', () => {
  it('combines the session directory and id', () => {
    expect(getSessionKey({ id: 'ses_1', location: { directory: '/w/a' } })).toBe('/w/a:ses_1')
  })
})

describe('buildPinnedSessionKeys', () => {
  it('builds a session key for each pin', () => {
    const keys = buildPinnedSessionKeys([{ directory: '/a', sessionId: 's1' }])

    expect(keys.has('/a:s1')).toBe(true)
    expect(keys.size).toBe(1)
  })
})
