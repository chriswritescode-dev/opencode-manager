import { describe, it, expect, afterEach } from 'vitest'
import { ENV } from '@opencode-manager/shared/config/env'
import { getOpenCodeUpstreamBaseUrl } from '../../../src/services/opencode/upstream'

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
    expect(getOpenCodeUpstreamBaseUrl()).toBe(`http://127.0.0.1:${ENV.OPENCODE.PORT}`)
  })

  it('leaves a plain hostname unchanged', () => {
    setHost('opencode.internal')
    expect(getOpenCodeUpstreamBaseUrl()).toBe(`http://opencode.internal:${ENV.OPENCODE.PORT}`)
  })

  it('brackets a bare IPv6 host', () => {
    setHost('::1')
    expect(getOpenCodeUpstreamBaseUrl()).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
  })

  it('does not double-bracket an already bracketed IPv6 host', () => {
    setHost('[::1]')
    expect(getOpenCodeUpstreamBaseUrl()).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
  })

  it('normalizes a wildcard bind to loopback', () => {
    setHost('0.0.0.0')
    expect(getOpenCodeUpstreamBaseUrl()).toBe(`http://127.0.0.1:${ENV.OPENCODE.PORT}`)
  })

  it('honours an explicit host override over the configured host', () => {
    setHost('192.168.1.10')
    expect(getOpenCodeUpstreamBaseUrl('::1')).toBe(`http://[::1]:${ENV.OPENCODE.PORT}`)
    expect(getOpenCodeUpstreamBaseUrl(() => '10.0.0.5')).toBe(`http://10.0.0.5:${ENV.OPENCODE.PORT}`)
  })
})
