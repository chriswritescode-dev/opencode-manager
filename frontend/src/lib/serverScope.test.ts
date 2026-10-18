import { describe, expect, it } from 'vitest'
import { serverScopedKey } from './serverScope'

describe('serverScopedKey', () => {
  it('returns the same key for the local server', () => {
    const key = ['opencode', 'sessions', '/repo']

    expect(serverScopedKey(key, 'local')).toBe(key)
    expect(serverScopedKey(key)).toBe(key)
  })

  it('appends the server id last for remote servers', () => {
    expect(serverScopedKey(['opencode', 'sessions', '/repo'], 'srv_abc')).toEqual([
      'opencode',
      'sessions',
      '/repo',
      'srv_abc',
    ])
  })
})
