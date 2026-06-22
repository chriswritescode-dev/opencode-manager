import { describe, it, expect } from 'vitest'
import {
  appendPreviewAccessToken,
  buildUpstreamWebSocketUrl,
  createPreviewAccessToken,
  selectWebSocketProtocol,
} from '../../../src/services/dev-server/preview-server'

describe('buildUpstreamWebSocketUrl', () => {
  it('targets the loopback dev server with path and search', () => {
    expect(buildUpstreamWebSocketUrl(3055, '/_next/webpack-hmr', '?token=abc')).toBe(
      'ws://127.0.0.1:3055/_next/webpack-hmr?token=abc'
    )
  })

  it('removes manager preview auth tokens before proxying upstream', () => {
    expect(buildUpstreamWebSocketUrl(3055, '/', '?token=vite&ocm_preview_token=manager')).toBe(
      'ws://127.0.0.1:3055/?token=vite'
    )
  })
})

describe('preview access tokens', () => {
  it('appends a signed preview token to the preview url', () => {
    const token = createPreviewAccessToken(1_000)
    const url = appendPreviewAccessToken('http://manager.example:3056/', token)

    expect(url).toBe(`http://manager.example:3056/?ocm_preview_token=${encodeURIComponent(token)}`)
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
