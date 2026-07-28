import { describe, it, expect, vi } from 'vitest'
import { createKeychainCredentialBackend, KEYCHAIN_SERVICE } from '../src/credential-keychain.js'
import { CredentialStoreError } from '../src/credential-backend.js'

type SpawnResult = { stdout: string | null; stderr: string | null; status: number | null; error?: Error }

const ok = (stdout = ''): SpawnResult => ({ stdout, stderr: '', status: 0 })
const enoent = (): SpawnResult => ({
  stdout: null,
  stderr: null,
  status: null,
  error: Object.assign(new Error('spawnSync security ENOENT'), { code: 'ENOENT' }),
})

const ACCOUNT = 'https://manager.example.com'

describe('keychain credential backend', () => {
  it('throws a diagnostic CredentialStoreError when the security binary is missing on get', () => {
    const spawn = vi.fn().mockReturnValue(enoent())
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.get(ACCOUNT)).toThrow(CredentialStoreError)
    expect(() => backend.get(ACCOUNT)).toThrow(/security/)
  })

  it('throws a diagnostic CredentialStoreError when the security binary is missing on set', () => {
    const spawn = vi.fn().mockReturnValue(enoent())
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.set(ACCOUNT, 'tok')).toThrow(CredentialStoreError)
    expect(() => backend.set(ACCOUNT, 'tok')).toThrow(/security/)
  })

  it('throws a diagnostic CredentialStoreError when the security binary is missing on delete', () => {
    const spawn = vi.fn().mockReturnValue(enoent())
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.delete(ACCOUNT)).toThrow(CredentialStoreError)
    expect(() => backend.delete(ACCOUNT)).toThrow(/security/)
  })

  it('invokes security with the exact add-generic-password argv including -U upsert', () => {
    const spawn = vi.fn().mockReturnValue(ok())
    const backend = createKeychainCredentialBackend(spawn)

    backend.set('https://m', 'tok')

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'security',
      ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w', 'tok', '-U'],
      { encoding: 'utf-8' },
    )
  })

  it('throws a CredentialStoreError containing stderr when set exits non-zero', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: 'boom', status: 1, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.set(ACCOUNT, 'tok')).toThrow(CredentialStoreError)
    expect(() => backend.set(ACCOUNT, 'tok')).toThrow(/boom/)
  })

  it('falls back to exit status in the set error when stderr is empty', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: '', status: 1, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    try {
      backend.set(ACCOUNT, 'tok')
      throw new Error('expected throw')
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('keychain')
      expect(e.message).toContain('exit status 1')
    }
  })

  it('falls back to exit status in the get error when stderr is empty', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: '', status: 36, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    try {
      backend.get(ACCOUNT)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('keychain')
      expect(e.message).toContain('exit status 36')
    }
  })

  it('falls back to exit status in the delete error when stderr is empty', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: '', status: 1, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    try {
      backend.delete(ACCOUNT)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('keychain')
      expect(e.message).toContain('exit status 1')
    }
  })

  it('reports process termination when there is no stderr and no exit status', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: '', status: null, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    try {
      backend.set(ACCOUNT, 'tok')
      throw new Error('expected throw')
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.message).toContain('terminated')
    }
  })

  it('invokes security with the exact find-generic-password -w argv on get', () => {
    const spawn = vi.fn().mockReturnValue(ok('tok_abc\n'))
    const backend = createKeychainCredentialBackend(spawn)

    backend.get('https://m')

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w'],
      { encoding: 'utf-8' },
    )
  })

  it('trims a trailing newline from get stdout', () => {
    const spawn = vi.fn().mockReturnValue(ok('tok_abc\n'))
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.get(ACCOUNT)).toBe('tok_abc')
  })

  it('returns null for an item-not-found exit without throwing', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: 'could not be found', status: 44, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.get(ACCOUNT)).toBeNull()
  })

  it('returns null when get stdout is empty after trimming', () => {
    const spawn = vi.fn().mockReturnValue(ok('\n'))
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.get(ACCOUNT)).toBeNull()
  })

  it('invokes security with the exact delete-generic-password argv and returns true on status 0', () => {
    const spawn = vi.fn().mockReturnValue(ok())
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.delete('https://m')).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m'],
      { encoding: 'utf-8' },
    )
  })

  it('returns false when delete exits with the item-not-found code', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: 'could not be found', status: 44, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.delete(ACCOUNT)).toBe(false)
  })

  it('throws a CredentialStoreError on a non-44 get failure', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: 'user interaction is not allowed', status: 36, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.get(ACCOUNT)).toThrow(CredentialStoreError)
    try {
      backend.get(ACCOUNT)
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('keychain')
      expect(e.message).toContain('user interaction is not allowed')
    }
  })

  it('throws a CredentialStoreError on a non-44 delete failure', () => {
    const spawn = vi.fn().mockReturnValue({ stdout: '', stderr: 'keychain locked', status: 1, error: undefined })
    const backend = createKeychainCredentialBackend(spawn)

    expect(() => backend.delete(ACCOUNT)).toThrow(CredentialStoreError)
    try {
      backend.delete(ACCOUNT)
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('keychain')
      expect(e.message).toContain('keychain locked')
    }
  })

  it('describes itself as a keychain backend with the service name', () => {
    const spawn = vi.fn()
    const backend = createKeychainCredentialBackend(spawn)

    expect(backend.describe()).toEqual({
      kind: 'keychain',
      location: `macOS Keychain (service ${KEYCHAIN_SERVICE})`,
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('exposes keychain as its kind', () => {
    const backend = createKeychainCredentialBackend(vi.fn())
    expect(backend.kind).toBe('keychain')
  })
})
