import { describe, expect, it } from 'vitest'
import { isLoopbackHost, isPrivateNetworkHost } from '@opencode-manager/shared/utils'

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.4.5.6', '::1', '[::1]'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true)
    },
  )

  it.each(['192.168.1.2', 'example.com', '100.64.0.1', '10.0.0.1'])(
    'treats %s as not loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false)
    },
  )
})

describe('isPrivateNetworkHost', () => {
  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.10.1',
    '100.64.0.1',
    '100.127.255.255',
    'fd7a:115c:a1e0::1',
    '[fd7a:115c:a1e0::1]',
    'fc00::1',
  ])('treats %s as private', (host) => {
    expect(isPrivateNetworkHost(host)).toBe(true)
  })

  it.each([
    '172.32.0.1',
    '100.128.0.1',
    '8.8.8.8',
    '127.0.0.1',
    '::1',
    'fe80::1',
    'example.ts.net',
    'host.local',
    '256.1.1.1',
    '10.0.0',
  ])('treats %s as public', (host) => {
    expect(isPrivateNetworkHost(host)).toBe(false)
  })
})
