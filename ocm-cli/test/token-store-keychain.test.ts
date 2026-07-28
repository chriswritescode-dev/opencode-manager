import { afterEach, describe, it, expect, vi } from 'vitest'
import { createKeychainTokenStore, formatSecurityCommand, KEYCHAIN_SERVICE } from '../src/token-store-keychain.js'
import type { SecurityResult } from '../src/token-store-keychain.js'
import { TokenStoreError } from '../src/token-store.js'

const ok = (stdout = ''): SecurityResult => ({ stdout, stderr: '', code: 0 })
const failed = (code: number | null, stderr = ''): SecurityResult => ({ stdout: '', stderr, code })
const unavailable = () => Promise.reject(
  new TokenStoreError("cannot run the macOS 'security' CLI: spawn /usr/bin/security ENOENT", 'keychain'),
)

const ACCOUNT = 'https://manager.example.com'

async function expectStoreError(run: () => Promise<unknown>, expected: { message: string | RegExp }) {
  const err = await run().then(() => null, (caught: unknown) => caught)
  expect(err).toBeInstanceOf(TokenStoreError)
  const storeError = err as TokenStoreError
  expect(storeError.kind).toBe('keychain')
  if (typeof expected.message === 'string') expect(storeError.message).toContain(expected.message)
  else expect(storeError.message).toMatch(expected.message)
  return storeError
}

describe('keychain token store', () => {
  it('rejects with a diagnostic TokenStoreError when the security binary is missing on get', async () => {
    const store = createKeychainTokenStore(unavailable)

    await expectStoreError(() => store.get(ACCOUNT), { message: /security/ })
  })

  it('rejects with a diagnostic TokenStoreError when the security binary is missing on set', async () => {
    const store = createKeychainTokenStore(unavailable)

    await expectStoreError(() => store.set(ACCOUNT, 'tok'), { message: /security/ })
  })

  it('rejects with a diagnostic TokenStoreError when the security binary is missing on delete', async () => {
    const store = createKeychainTokenStore(unavailable)

    await expectStoreError(() => store.delete(ACCOUNT), { message: /security/ })
  })

  it('invokes security with the exact add-generic-password argv including -U upsert', async () => {
    const run = vi.fn().mockResolvedValue(ok())
    const store = createKeychainTokenStore(run)

    await store.set('https://m', 'tok')

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w', 'tok', '-U'],
    )
  })

  it('rejects with a TokenStoreError containing stderr when set exits non-zero', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(1, 'boom')))

    await expectStoreError(() => store.set(ACCOUNT, 'tok'), { message: 'boom' })
  })

  it('falls back to exit status in the set error when stderr is empty', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(1)))

    await expectStoreError(() => store.set(ACCOUNT, 'tok'), { message: 'exit status 1' })
  })

  it('falls back to exit status in the get error when stderr is empty', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(36)))

    await expectStoreError(() => store.get(ACCOUNT), { message: 'exit status 36' })
  })

  it('falls back to exit status in the delete error when stderr is empty', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(1)))

    await expectStoreError(() => store.delete(ACCOUNT), { message: 'exit status 1' })
  })

  it('reports process termination when there is no stderr and no exit status', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(null)))

    await expectStoreError(() => store.set(ACCOUNT, 'tok'), { message: 'terminated' })
  })

  it('invokes security with the exact find-generic-password -w argv on get', async () => {
    const run = vi.fn().mockResolvedValue(ok('tok_abc\n'))
    const store = createKeychainTokenStore(run)

    await store.get('https://m')

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w'],
    )
  })

  it('trims a trailing newline from get stdout', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(ok('tok_abc\n')))

    await expect(store.get(ACCOUNT)).resolves.toBe('tok_abc')
  })

  it('returns null for an item-not-found exit without throwing', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(44, 'could not be found')))

    await expect(store.get(ACCOUNT)).resolves.toBeNull()
  })

  it('returns null when get stdout is empty after trimming', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(ok('\n')))

    await expect(store.get(ACCOUNT)).resolves.toBeNull()
  })

  it('invokes security with the exact delete-generic-password argv and returns true on status 0', async () => {
    const run = vi.fn().mockResolvedValue(ok())
    const store = createKeychainTokenStore(run)

    await expect(store.delete('https://m')).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith(
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m'],
    )
  })

  it('returns false when delete exits with the item-not-found code', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(44, 'could not be found')))

    await expect(store.delete(ACCOUNT)).resolves.toBe(false)
  })

  it('rejects with a TokenStoreError on a non-44 get failure', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(36, 'user interaction is not allowed')))

    await expectStoreError(() => store.get(ACCOUNT), { message: 'user interaction is not allowed' })
  })

  it('rejects with a TokenStoreError on a non-44 delete failure', async () => {
    const store = createKeychainTokenStore(() => Promise.resolve(failed(1, 'keychain locked')))

    await expectStoreError(() => store.delete(ACCOUNT), { message: 'keychain locked' })
  })

  it('quotes every security argument and escapes backslashes and quotes', () => {
    expect(formatSecurityCommand(['add-generic-password', '-a', 'a"b\\c', '-w', 'tok en'])).toBe(
      '"add-generic-password" "-a" "a\\"b\\\\c" "-w" "tok en"\n',
    )
  })

  it('refuses arguments containing line breaks so they cannot inject extra security commands', () => {
    expect(() => formatSecurityCommand(['add-generic-password', '-w', 'tok\ndelete-generic-password']))
      .toThrow(TokenStoreError)
  })

  it('describes itself as a keychain store with the service name', () => {
    const run = vi.fn()
    const store = createKeychainTokenStore(run)

    expect(store.describe()).toEqual({
      kind: 'keychain',
      location: `macOS Keychain (service ${KEYCHAIN_SERVICE})`,
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('keychain token store process arguments', () => {
  afterEach(() => {
    vi.doUnmock('child_process')
    vi.resetModules()
  })

  it('sends the token on stdin and never puts it in the security argv', async () => {
    const end = vi.fn()
    const execFile = vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '', '')
      return { stdin: { on: vi.fn(), end } }
    })
    vi.doMock('child_process', () => ({ execFile }))
    vi.resetModules()
    const { createKeychainTokenStore: create } = await import('../src/token-store-keychain.js')

    await create().set('https://m', 'sup3r-secret')

    expect(execFile).toHaveBeenCalledOnce()
    expect(execFile.mock.calls[0]![0]).toBe('/usr/bin/security')
    expect(execFile.mock.calls[0]![1]).toEqual(['-i'])
    expect(end).toHaveBeenCalledWith(
      `"add-generic-password" "-s" "${KEYCHAIN_SERVICE}" "-a" "https://m" "-w" "sup3r-secret" "-U"\n`,
    )
  })
})
