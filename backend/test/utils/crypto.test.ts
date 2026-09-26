import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ENV } from '@opencode-manager/shared/config/env'

const scryptSyncSpy = vi.hoisted(() => vi.fn())
const cryptoActual = vi.hoisted(() => ({
  scryptSync: undefined as unknown as typeof import('crypto').scryptSync,
}))

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  cryptoActual.scryptSync = actual.scryptSync
  return {
    ...actual,
    scryptSync: scryptSyncSpy,
  }
})

import { encryptSecret, decryptSecret } from '../../src/utils/crypto'

const mutableAuth = ENV.AUTH as unknown as { SECRET: string }
const originalSecret = ENV.AUTH.SECRET

describe('crypto secret derivation', () => {
  beforeEach(() => {
    scryptSyncSpy.mockReset()
    scryptSyncSpy.mockImplementation((secret: string, salt: Buffer, keylen: number) =>
      cryptoActual.scryptSync(secret, salt, keylen),
    )
  })

  afterEach(() => {
    mutableAuth.SECRET = originalSecret
  })

  it('derives the key once for repeated calls with the same secret', () => {
    mutableAuth.SECRET = 'memoized-secret'
    scryptSyncSpy.mockClear()

    const first = encryptSecret('alpha')
    const second = encryptSecret('beta')
    expect(decryptSecret(first)).toBe('alpha')
    expect(decryptSecret(second)).toBe('beta')

    expect(scryptSyncSpy).toHaveBeenCalledTimes(1)
    expect(scryptSyncSpy).toHaveBeenCalledWith('memoized-secret', expect.any(Buffer), 32)
  })

  it('derives a new key when the secret changes', () => {
    mutableAuth.SECRET = 'secret-one'
    encryptSecret('alpha')
    mutableAuth.SECRET = 'secret-two'
    encryptSecret('beta')

    expect(scryptSyncSpy).toHaveBeenCalledTimes(2)
    expect(scryptSyncSpy).toHaveBeenNthCalledWith(1, 'secret-one', expect.any(Buffer), 32)
    expect(scryptSyncSpy).toHaveBeenNthCalledWith(2, 'secret-two', expect.any(Buffer), 32)
  })

  it('throws when the secret is missing', () => {
    mutableAuth.SECRET = ''
    expect(() => encryptSecret('alpha')).toThrow('AUTH_SECRET must be configured for encryption')
  })
})
