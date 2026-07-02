import { describe, it, expect } from 'vitest'
import {
  buildUpstreamWebSocketUrl,
  selectWebSocketProtocol,
} from '../../../src/services/dev-server/preview-server'

describe('buildUpstreamWebSocketUrl', () => {
  it('targets the loopback dev server with path and search', () => {
    expect(buildUpstreamWebSocketUrl(3055, '/_next/webpack-hmr', '?token=abc')).toBe(
      'ws://127.0.0.1:3055/_next/webpack-hmr?token=abc'
    )
  })
})

describe('selectWebSocketProtocol', () => {
  it('selects the first offered protocol', () => {
    expect(selectWebSocketProtocol('vite-hmr, other')).toBe('vite-hmr')
  })

  it('returns null when no protocol is offered', () => {
    expect(selectWebSocketProtocol(null)).toBeNull()
  })
})
