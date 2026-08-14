import { describe, it, expect, afterEach } from 'vitest'
import { ENV } from '@opencode-manager/shared/config/env'
import { getOpenCodeUpstreamBaseUrl, resolveEffectiveServerHost } from '../../../src/services/opencode/upstream'

const originalHost = ENV.OPENCODE.HOST

function setHost(value: string): void {
  Object.defineProperty(ENV.OPENCODE, 'HOST', { value, configurable: true, writable: true })
}

describe('getOpenCodeUpstreamBaseUrl', () => {
  afterEach(() => {
    setHost(originalHost)
  })

  it('leaves an IPv4 host unchanged', () => {
    setHost('127.0.0.1')
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://127.0.0.1:${ENV.OPENCODE.PORT}`)
  })

  it('leaves a plain hostname unchanged', () => {
    setHost('opencode.internal')
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://opencode.internal:${ENV.OPENCODE.PORT}`)
  })

  it('brackets a bare IPv6 host', () => {
    setHost('::1')
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
  })

  it('does not double-bracket an already bracketed IPv6 host', () => {
    setHost('[::1]')
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
  })

  it('normalizes a wildcard bind to loopback', () => {
    setHost('0.0.0.0')
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://127.0.0.1:${ENV.OPENCODE.PORT}`)
  })

  it('forces loopback for a non-loopback host while enforcement is active', () => {
    setHost('192.168.1.10')
    expect(getOpenCodeUpstreamBaseUrl(true)).toBe(`http://127.0.0.1:${ENV.OPENCODE.PORT}`)
    expect(getOpenCodeUpstreamBaseUrl(false)).toBe(`http://192.168.1.10:${ENV.OPENCODE.PORT}`)
  })

  it('keeps an IPv6 loopback host while enforcement is active', () => {
    setHost('::1')
    expect(getOpenCodeUpstreamBaseUrl(true)).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
  })

  it('honours an explicit host override over the configured host', () => {
    setHost('192.168.1.10')
    expect(getOpenCodeUpstreamBaseUrl(false, '::1')).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
    expect(getOpenCodeUpstreamBaseUrl(false, () => '10.0.0.5')).toBe(`http://10.0.0.5:${ENV.OPENCODE.PORT}`)
  })
})

describe('resolveEffectiveServerHost', () => {
  afterEach(() => {
    setHost(originalHost)
  })

  it('treats every loopback spelling as already bound to loopback', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '127.1.2.3', '[::1]']) {
      setHost(host)
      expect(resolveEffectiveServerHost(true)).toBe(host)
    }
  })

  it('rebinds a non-loopback host to loopback while enforcement is active', () => {
    setHost('0.0.0.0')
    expect(resolveEffectiveServerHost(true)).toBe('127.0.0.1')
    expect(resolveEffectiveServerHost(false)).toBe('0.0.0.0')
  })
})
