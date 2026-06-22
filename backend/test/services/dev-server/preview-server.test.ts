import { describe, it, expect } from 'vitest'
import { buildPreviewUpgradeRequest } from '../../../src/services/dev-server/preview-server'

describe('buildPreviewUpgradeRequest', () => {
  it('preserves the request line and forces the loopback host', () => {
    const rawHead = [
      'GET /_next/webpack-hmr HTTP/1.1',
      'Host: manager.example:3056',
      'Upgrade: websocket',
      'Connection: Upgrade',
    ].join('\r\n')

    const result = buildPreviewUpgradeRequest(rawHead, 3055)
    const lines = result.split('\r\n')

    expect(lines[0]).toBe('GET /_next/webpack-hmr HTTP/1.1')
    expect(result).toContain('Upgrade: websocket')
    expect(result).toContain('Connection: Upgrade')
    expect(result).toContain('Host: 127.0.0.1:3055')
    expect(result).not.toContain('Host: manager.example:3056')
  })

  it('returns the raw head unchanged when empty', () => {
    expect(buildPreviewUpgradeRequest('', 3055)).toBe('')
  })
})
