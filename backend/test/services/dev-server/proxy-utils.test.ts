import { describe, it, expect } from 'vitest'
import {
  buildUpstreamUrl,
  filterProxyHeaders,
  sanitizeUpstreamResponseHeaders,
  resolveDevPreviewUrl,
} from '../../../src/services/dev-server/proxy-utils'

describe('buildUpstreamUrl', () => {
  it('targets the loopback dev server with path and search', () => {
    expect(buildUpstreamUrl(3055, '/_next/static/chunk.js', '?v=1')).toBe(
      'http://127.0.0.1:3055/_next/static/chunk.js?v=1'
    )
  })
})

describe('filterProxyHeaders', () => {
  it('drops hop-by-hop and host headers', () => {
    const headers = new Headers({
      host: 'manager.example',
      connection: 'keep-alive',
      'content-type': 'text/html',
      accept: '*/*',
    })

    const result = filterProxyHeaders(headers)

    expect(result.host).toBeUndefined()
    expect(result.connection).toBeUndefined()
    expect(result['content-type']).toBe('text/html')
    expect(result.accept).toBe('*/*')
  })
})

describe('sanitizeUpstreamResponseHeaders', () => {
  it('strips framing/security headers and forces no-referrer', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    })

    const result = sanitizeUpstreamResponseHeaders(headers)

    expect(result['content-type']).toBe('text/html')
    expect(result['x-frame-options']).toBeUndefined()
    expect(result['content-security-policy']).toBeUndefined()
    expect(result['referrer-policy']).toBe('no-referrer')
  })
})

describe('resolveDevPreviewUrl', () => {
  it('derives the preview origin from the request host and preview port', () => {
    expect(resolveDevPreviewUrl('manager.example:5003', undefined)).toBe('http://manager.example:3056/')
  })

  it('honours the forwarded protocol', () => {
    expect(resolveDevPreviewUrl('manager.example:5003', 'https')).toBe('https://manager.example:3056/')
  })

  it('handles bracketed IPv6 hosts', () => {
    expect(resolveDevPreviewUrl('[::1]:5003', undefined)).toBe('http://[::1]:3056/')
  })

  it('falls back to localhost when no host is provided', () => {
    expect(resolveDevPreviewUrl(undefined, undefined)).toBe('http://localhost:3056/')
  })
})
