import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadToWebSocketUrl() {
  vi.resetModules()
  const { toWebSocketUrl } = await import('./websocket-url')
  return toWebSocketUrl
}

describe('toWebSocketUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the page origin over http when no API base url is configured', async () => {
    const toWebSocketUrl = await loadToWebSocketUrl()

    expect(toWebSocketUrl('/api/repos/1/terminals/t/connect')).toBe(
      'ws://localhost/api/repos/1/terminals/t/connect',
    )
  })

  it('uses the page origin over https when no API base url is configured', async () => {
    const toWebSocketUrl = await loadToWebSocketUrl()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://example.com'),
    })
    try {
      expect(toWebSocketUrl('/api/x')).toBe('wss://example.com/api/x')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('uses an absolute API base url and preserves the query', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    const toWebSocketUrl = await loadToWebSocketUrl()

    expect(toWebSocketUrl('/api/x?directory=%2Ftmp')).toBe('wss://api.example.com/api/x?directory=%2Ftmp')
  })
})
