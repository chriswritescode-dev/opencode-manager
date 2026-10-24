import { describe, expect, it } from 'vitest'
import { getTrustedOrigins, isTrustedOrigin } from '@opencode-manager/shared/config/env'

const TRUSTED = ['https://m.example.com', 'http://localhost:5173'] as const

describe('isTrustedOrigin', () => {
  it('accepts a listed origin', () => {
    expect(isTrustedOrigin('https://m.example.com', {}, TRUSTED)).toBe(true)
    expect(isTrustedOrigin('https://m.example.com', { requireOrigin: true }, TRUSTED)).toBe(true)
  })

  it('rejects an unlisted origin', () => {
    expect(isTrustedOrigin('https://evil.example', {}, TRUSTED)).toBe(false)
    expect(isTrustedOrigin('https://evil.example', { requireOrigin: true }, TRUSTED)).toBe(false)
  })

  it('treats a missing origin as trusted unless an origin is required', () => {
    expect(isTrustedOrigin(undefined, {}, TRUSTED)).toBe(true)
    expect(isTrustedOrigin(undefined, { requireOrigin: true }, TRUSTED)).toBe(false)
  })

  it('treats an empty origin as missing', () => {
    expect(isTrustedOrigin('', {}, TRUSTED)).toBe(true)
    expect(isTrustedOrigin('', { requireOrigin: true }, TRUSTED)).toBe(false)
  })

  it('treats the null origin as untrusted', () => {
    expect(isTrustedOrigin('null', {}, TRUSTED)).toBe(false)
    expect(isTrustedOrigin('null', { requireOrigin: true }, [...TRUSTED, 'null'])).toBe(false)
  })

  it('reads the configured origins by default', () => {
    const configured = getTrustedOrigins()
    expect(configured.length).toBeGreaterThan(0)
    expect(isTrustedOrigin(configured[0])).toBe(true)
    expect(isTrustedOrigin('https://not-configured.example')).toBe(false)
  })
})
