import { describe, it, expect, afterEach } from 'vitest'
import { ENV, getWorkspacePath } from '@opencode-manager/shared/config/env'
import { getOpenCodeUpstreamBaseUrl, toWebSocketUrl, withDefaultOpenCodeDirectory } from '../../../src/services/opencode/upstream'

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

describe('withDefaultOpenCodeDirectory', () => {
  it('scopes a request without a directory header to the workspace', () => {
    expect(withDefaultOpenCodeDirectory({ accept: 'application/json' })).toEqual({
      accept: 'application/json',
      'x-opencode-directory': encodeURIComponent(getWorkspacePath()),
    })
  })

  it('keeps a caller-supplied directory header regardless of its case', () => {
    const headers = { 'X-OpenCode-Directory': '%2Frepo' }
    expect(withDefaultOpenCodeDirectory(headers)).toBe(headers)
  })
})

describe('toWebSocketUrl', () => {
  it('maps an http URL to ws and preserves the path, port and query', () => {
    expect(toWebSocketUrl('http://127.0.0.1:5551/api/pty/pty-1/connect?ticket=abc')).toBe(
      'ws://127.0.0.1:5551/api/pty/pty-1/connect?ticket=abc',
    )
  })

  it('maps an https URL to wss', () => {
    expect(toWebSocketUrl('https://opencode.internal/api/pty/pty-1/connect')).toBe(
      'wss://opencode.internal/api/pty/pty-1/connect',
    )
  })

  it('leaves a ws URL unchanged', () => {
    expect(toWebSocketUrl('ws://127.0.0.1:5551/api/pty/pty-1/connect')).toBe('ws://127.0.0.1:5551/api/pty/pty-1/connect')
  })

  it('leaves a wss URL unchanged', () => {
    expect(toWebSocketUrl('wss://opencode.internal/api')).toBe('wss://opencode.internal/api')
  })
})
