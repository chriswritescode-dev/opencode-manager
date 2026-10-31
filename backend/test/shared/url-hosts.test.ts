import { describe, expect, it } from 'vitest'
import {
  isLoopbackHost,
  isPrivateNetworkHost,
  isPublicPlainHttpUrl,
  parseHttpUrl,
  readHttpOrigin,
} from '@opencode-manager/shared/utils'

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

describe('isPublicPlainHttpUrl', () => {
  it.each([
    'http://example.com',
    'http://example.com.',
    'http://203.0.113.5:5003',
    'http://8.8.8.8:5003/path',
  ])('treats %s as public plain http', (url) => {
    expect(isPublicPlainHttpUrl(new URL(url))).toBe(true)
  })

  it.each([
    'https://example.com',
    'https://203.0.113.5:5003',
    'http://localhost:5173',
    'http://127.0.0.1:5003',
    'http://[::1]:5003',
    'http://192.168.1.20:5003',
    'http://172.16.0.1:5003',
    'http://100.64.0.1:5003',
    'http://[fd00::1]:5003',
  ])('treats %s as not public plain http', (url) => {
    expect(isPublicPlainHttpUrl(new URL(url))).toBe(false)
  })
})

describe('parseHttpUrl', () => {
  it('parses an absolute http url', () => {
    expect(parseHttpUrl('http://m.example.com:5003/pair?x=1')?.origin).toBe(
      'http://m.example.com:5003',
    )
  })

  it('parses an absolute https url with surrounding whitespace', () => {
    expect(parseHttpUrl('  https://m.example.com/settings?tab=pairing  ')?.origin).toBe(
      'https://m.example.com',
    )
  })

  it.each(['', 'not a url', '//m.example.com', 'ocm://link?v=2&kind=manager', 'ftp://example.com'])(
    'returns null for %s',
    (value) => {
      expect(parseHttpUrl(value)).toBeNull()
    },
  )
})

describe('readHttpOrigin', () => {
  it.each([
    ['http://m.example.com:5003', 'http://m.example.com:5003'],
    ['https://m.example.com', 'https://m.example.com'],
  ])('returns the origin of %s', (value, expected) => {
    expect(readHttpOrigin(value)).toBe(expected)
  })

  it('strips the path to the origin', () => {
    expect(readHttpOrigin('https://m.example.com:5003/pair?x=1#top')).toBe(
      'https://m.example.com:5003',
    )
  })

  it.each(['', 'not a url', '//m.example.com', 'ocm://link?v=2&kind=manager', 'ftp://example.com'])(
    'returns null for %s',
    (value) => {
      expect(readHttpOrigin(value)).toBeNull()
    },
  )
})
