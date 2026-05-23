import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    AUTH: { SECRET: 'test-secret-for-hmac' },
  },
}))

describe('repo-target-token', () => {
  let createRepoTargetToken: typeof import('../../src/services/opencode/repo-target-token').createRepoTargetToken
  let verifyRepoTargetToken: typeof import('../../src/services/opencode/repo-target-token').verifyRepoTargetToken

  beforeEach(async () => {
    const mod = await import('../../src/services/opencode/repo-target-token')
    createRepoTargetToken = mod.createRepoTargetToken
    verifyRepoTargetToken = mod.verifyRepoTargetToken
  })

  it('creates a token with three colon-separated parts', () => {
    const token = createRepoTargetToken(42)
    const parts = token.split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('42')
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/)
    expect(parts[2]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies a valid token and returns the repoId', () => {
    const token = createRepoTargetToken(42)
    const result = verifyRepoTargetToken(token)
    expect(result).toEqual({ repoId: 42 })
  })

  it('rejects an invalid token', () => {
    const result = verifyRepoTargetToken('invalid-token')
    expect(result).toBeNull()
  })

  it('rejects a token for a different repoId', () => {
    const token = createRepoTargetToken(42)
    const parts = token.split(':')
    const tamperedToken = `99:${parts[1]}:${parts[2]}`
    const result = verifyRepoTargetToken(tamperedToken)
    expect(result).toBeNull()
  })

  it('rejects a token with a forged signature', () => {
    const token = createRepoTargetToken(42)
    const parts = token.split(':')
    const forgedToken = `${parts[0]}:${parts[1]}:${'a'.repeat(64)}`
    const result = verifyRepoTargetToken(forgedToken)
    expect(result).toBeNull()
  })

  it('generates unique tokens each call', () => {
    const token1 = createRepoTargetToken(42)
    const token2 = createRepoTargetToken(42)
    expect(token1).not.toBe(token2)
  })

  it('rejects tokens with wrong number of parts', () => {
    expect(verifyRepoTargetToken('a:b')).toBeNull()
    expect(verifyRepoTargetToken('a:b:c:d')).toBeNull()
    expect(verifyRepoTargetToken('')).toBeNull()
  })

  it('rejects tokens with non-numeric repoId', () => {
    expect(verifyRepoTargetToken('abc:def:ghi')).toBeNull()
  })
})
