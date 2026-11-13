import { afterEach, describe, expect, it } from 'vitest'
import { ENV } from '@opencode-manager/shared/config/env'
import { decryptSecret, encryptSecret } from '../../src/utils/crypto'

const originalSecret = ENV.AUTH.SECRET

function setAuthSecret(secret: string): void {
  Object.defineProperty(ENV.AUTH, 'SECRET', { value: secret, configurable: true, writable: true })
}

afterEach(() => {
  setAuthSecret(originalSecret)
})

describe('secret encryption', () => {
  it('round-trips every value encrypted under the same secret', () => {
    setAuthSecret('memoized-secret')

    const first = encryptSecret('alpha')
    const second = encryptSecret('beta')

    expect(decryptSecret(first)).toBe('alpha')
    expect(decryptSecret(second)).toBe('beta')
  })

  it('produces a fresh ciphertext for the same plaintext', () => {
    const first = encryptSecret('same')
    const second = encryptSecret('same')

    expect(first).not.toBe(second)
    expect(decryptSecret(first)).toBe('same')
    expect(decryptSecret(second)).toBe('same')
  })

  it('no longer decrypts existing ciphertext after the secret changes', () => {
    setAuthSecret('secret-one')
    const encrypted = encryptSecret('alpha')

    setAuthSecret('secret-two')

    expect(() => decryptSecret(encrypted)).toThrow()
    expect(decryptSecret(encryptSecret('alpha'))).toBe('alpha')
  })

  it('throws when the secret is missing', () => {
    setAuthSecret('')

    expect(() => encryptSecret('alpha')).toThrow('AUTH_SECRET must be configured for encryption')
  })

  it('rejects a ciphertext that is too short to carry an iv and auth tag', () => {
    expect(() => decryptSecret(Buffer.from('short').toString('base64'))).toThrow('Invalid encrypted data format')
  })
})
