import { describe, it, expect, vi } from 'vitest'
import { createKeychainTokenStore, createSecurityRunner, formatSecurityCommand, KEYCHAIN_SERVICE } from '../src/token-store-keychain.js'
import type { SecurityExec, SecurityResult, SecurityRunner } from '../src/token-store-keychain.js'
import type { TokenStore } from '../src/token-store.js'
import { TokenStoreError } from '../src/token-store.js'

const ok = (stdout = ''): SecurityResult => ({ stdout, stderr: '', code: 0 })
const failed = (code: number | null, stderr = ''): SecurityResult => ({ stdout: '', stderr, code })
const unavailable = () => Promise.reject(
  new TokenStoreError("cannot run the macOS 'security' CLI: spawn /usr/bin/security ENOENT", 'keychain'),
)

const ACCOUNT = 'https://manager.example.com'

async function expectStoreError(run: Promise<unknown>, expected: { message: string | RegExp }): Promise<TokenStoreError> {
  const failure = await run.then(() => null, (cause) => cause)
  expect(failure).toBeInstanceOf(TokenStoreError)
  if (!(failure instanceof TokenStoreError)) throw new Error('expected a TokenStoreError from the keychain store')
  expect(failure.kind).toBe('keychain')
  if (expected.message instanceof RegExp) expect(failure.message).toMatch(expected.message)
  else expect(failure.message).toContain(expected.message)
  return failure
}

function storeOf(run: SecurityRunner): TokenStore {
  return createKeychainTokenStore(run)
}

describe('keychain token store', () => {
  it.each([
    ['get', (store: TokenStore) => store.get(ACCOUNT)],
    ['set', (store: TokenStore) => store.set(ACCOUNT, 'tok')],
    ['delete', (store: TokenStore) => store.delete(ACCOUNT)],
  ] as const)('rejects with a diagnostic TokenStoreError when the security binary is missing on %s', async (_label, action) => {
    const store = storeOf(unavailable)

    await expectStoreError(action(store), { message: /security/ })
  })

  it('invokes security with the exact add-generic-password argv including -U upsert', async () => {
    const run = vi.fn<SecurityRunner>().mockResolvedValue(ok())
    const store = storeOf(run)

    await store.set('https://m', 'tok')

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w', 'tok', '-U'],
    )
  })

  it('rejects with a TokenStoreError containing stderr when set exits non-zero', async () => {
    const store = storeOf(() => Promise.resolve(failed(1, 'boom')))

    await expectStoreError(store.set(ACCOUNT, 'tok'), { message: 'boom' })
  })

  it.each([
    ['set', (store: TokenStore) => store.set(ACCOUNT, 'tok'), 1],
    ['get', (store: TokenStore) => store.get(ACCOUNT), 36],
    ['delete', (store: TokenStore) => store.delete(ACCOUNT), 1],
  ] as const)('falls back to exit status in the %s error when stderr is empty', async (_label, action, code) => {
    const store = storeOf(() => Promise.resolve(failed(code)))

    await expectStoreError(action(store), { message: `exit status ${code}` })
  })

  it('reports process termination when there is no stderr and no exit status', async () => {
    const store = storeOf(() => Promise.resolve(failed(null)))

    await expectStoreError(store.set(ACCOUNT, 'tok'), { message: 'terminated' })
  })

  it('invokes security with the exact find-generic-password -w argv on get', async () => {
    const run = vi.fn<SecurityRunner>().mockResolvedValue(ok('tok_abc\n'))
    const store = storeOf(run)

    await store.get('https://m')

    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w'],
    )
  })

  it('trims a trailing newline from get stdout', async () => {
    const store = storeOf(() => Promise.resolve(ok('tok_abc\n')))

    await expect(store.get(ACCOUNT)).resolves.toBe('tok_abc')
  })

  it('returns null for an item-not-found exit without throwing', async () => {
    const store = storeOf(() => Promise.resolve(failed(44, 'could not be found')))

    await expect(store.get(ACCOUNT)).resolves.toBeNull()
  })

  it('returns null when get stdout is empty after trimming', async () => {
    const store = storeOf(() => Promise.resolve(ok('\n')))

    await expect(store.get(ACCOUNT)).resolves.toBeNull()
  })

  it('invokes security with the exact delete-generic-password argv and returns true on status 0', async () => {
    const run = vi.fn<SecurityRunner>().mockResolvedValue(ok())
    const store = storeOf(run)

    await expect(store.delete('https://m')).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith(
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m'],
    )
  })

  it('returns false when delete exits with the item-not-found code', async () => {
    const store = storeOf(() => Promise.resolve(failed(44, 'could not be found')))

    await expect(store.delete(ACCOUNT)).resolves.toBe(false)
  })

  it('rejects with a TokenStoreError on a non-44 get failure', async () => {
    const store = storeOf(() => Promise.resolve(failed(36, 'user interaction is not allowed')))

    await expectStoreError(store.get(ACCOUNT), { message: 'user interaction is not allowed' })
  })

  it('rejects with a TokenStoreError on a non-44 delete failure', async () => {
    const store = storeOf(() => Promise.resolve(failed(1, 'keychain locked')))

    await expectStoreError(store.delete(ACCOUNT), { message: 'keychain locked' })
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
    const run = vi.fn<SecurityRunner>()
    const store = storeOf(run)

    expect(store.describe()).toEqual({
      kind: 'keychain',
      location: `macOS Keychain (service ${KEYCHAIN_SERVICE})`,
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('keychain security process', () => {
  it('sends the token on stdin and never puts it in the security argv', async () => {
    const end = vi.fn<(command: string) => void>()
    const exec = vi.fn<SecurityExec>((_bin, _args, _options, callback) => {
      callback(null, '', '')
      return { stdin: { on: vi.fn(), end } }
    })
    const run = createSecurityRunner(exec)

    await run(['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'https://m', '-w', 'sup3r-secret', '-U'])

    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0]![0]).toBe('/usr/bin/security')
    expect(exec.mock.calls[0]![1]).toEqual(['-i'])
    expect(end).toHaveBeenCalledWith(
      `"add-generic-password" "-s" "${KEYCHAIN_SERVICE}" "-a" "https://m" "-w" "sup3r-secret" "-U"\n`,
    )
  })

  it('reports a failure to start the security process as a TokenStoreError', async () => {
    const exec = vi.fn<SecurityExec>((_bin, _args, _options, callback) => {
      callback({ message: 'spawn /usr/bin/security ENOENT' }, '', '')
      return { stdin: { on: vi.fn(), end: vi.fn() } }
    })
    const run = createSecurityRunner(exec)

    await expectStoreError(run(['find-generic-password', '-w']), { message: /could not be found|security/ })
  })
})
