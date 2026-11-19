import { describe, expect, it } from 'vitest'
import {
  buildPreviewStartUrl,
  getPreviewOrigin,
  isSameOriginAsManager,
  parseLocalDevUrl,
  parsePort,
} from './preview-url'

const managerLocation = {
  protocol: 'http:',
  hostname: 'manager.local',
  origin: 'http://manager.local:5003',
}

describe('parsePort', () => {
  it.each([
    ['5173', 5173],
    ['1', 1],
    ['65535', 65535],
  ])('parses %s', (value, port) => {
    expect(parsePort(value)).toBe(port)
  })

  it.each(['', '0', '65536', 'abc', '-1', '5173.5'])('rejects %s', (value) => {
    expect(parsePort(value)).toBeNull()
  })
})

describe('parseLocalDevUrl', () => {
  it.each([
    ['http://localhost:5173', 5173, '/'],
    ['http://localhost:5173/app?x=1#top', 5173, '/app?x=1#top'],
    ['https://127.0.0.1:3000/', 3000, '/'],
    ['http://0.0.0.0:8080/foo', 8080, '/foo'],
    ['http://[::1]:4000/bar', 4000, '/bar'],
  ])('parses %s', (url, port, path) => {
    expect(parseLocalDevUrl(url)).toEqual({ port, path })
  })

  it.each([
    'http://example.com:5173',
    'http://localhost',
    'ftp://localhost:5173',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseLocalDevUrl(url)).toBeNull()
  })
})

describe('getPreviewOrigin', () => {
  it('uses the public URL origin when set', () => {
    expect(
      getPreviewOrigin({ previewPort: 5004, publicUrl: 'https://preview.example.com/base' }, managerLocation),
    ).toBe('https://preview.example.com')
  })

  it('falls back to the manager host and preview port', () => {
    expect(
      getPreviewOrigin({ previewPort: 5004, publicUrl: null }, managerLocation),
    ).toBe('http://manager.local:5004')
  })
})

describe('buildPreviewStartUrl', () => {
  it('encodes the token and path against the preview origin', () => {
    const url = buildPreviewStartUrl(
      { token: 'tok en', previewPort: 5004, publicUrl: null },
      '/a b?x=1',
      managerLocation,
    )

    expect(url).toBe('http://manager.local:5004/__ocm_preview/start?token=tok+en&path=%2Fa+b%3Fx%3D1')
  })
})

describe('isSameOriginAsManager', () => {
  it('matches the manager origin and rejects another port', () => {
    expect(isSameOriginAsManager('http://manager.local:5003', managerLocation)).toBe(true)
    expect(isSameOriginAsManager('http://manager.local:5004', managerLocation)).toBe(false)
  })
})
