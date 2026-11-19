import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TOKEN_ENV,
  selectTokenStore,
  getToken,
  setToken,
  deleteToken,
  hasStoredToken,
  envToken,
  describeTokenStore,
  describeTokenWriteTarget,
  TokenStoreError,
} from '../src/internal-token-store.js'
import type { TokenStore } from '../src/token-store.js'

interface StoreCalls {
  get: string[]
  set: Array<{ account: string; token: string }>
  delete: string[]
}

function makeInMemoryStore(seed: Record<string, string> = {}): TokenStore & { calls: StoreCalls } {
  const tokens = { ...seed }
  const calls: StoreCalls = { get: [], set: [], delete: [] }
  return {
    describe: () => ({ kind: 'file', location: '<in-memory>' }),
    async get(account: string) {
      calls.get.push(account)
      return tokens[account] ?? null
    },
    async set(account: string, token: string) {
      calls.set.push({ account, token })
      tokens[account] = token
    },
    async delete(account: string) {
      calls.delete.push(account)
      if (!(account in tokens)) return false
      delete tokens[account]
      return true
    },
    calls,
  }
}

function makeFailingStore(err: TokenStoreError): TokenStore {
  return {
    describe: () => ({ kind: 'file', location: '<failing>' }),
    get: () => Promise.reject(err),
    set: () => Promise.reject(err),
    delete: () => Promise.reject(err),
  }
}

describe('internal token store facade', () => {
  const savedToken = process.env[TOKEN_ENV]

  beforeEach(() => {
    delete process.env[TOKEN_ENV]
  })

  afterEach(() => {
    if (savedToken === undefined) delete process.env[TOKEN_ENV]
    else process.env[TOKEN_ENV] = savedToken
  })

  describe('selectTokenStore', () => {
    it.each([
      ['darwin', 'keychain'],
      ['linux', 'file'],
      ['win32', 'file'],
    ] as const)('selects the %s store as %s', (platform, kind) => {
      expect(selectTokenStore(platform).describe().kind).toBe(kind)
    })
  })

  it('getToken returns the stored token', async () => {
    const store = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', store)).resolves.toBe('tok_stored')
    expect(store.calls.get).toEqual(['https://m'])
  })

  it('OCM_TOKEN wins over the store whether or not it holds a token', async () => {
    process.env[TOKEN_ENV] = 'tok_env'
    const populated = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', populated)).resolves.toBe('tok_env')
    expect(populated.calls.get).toEqual([])

    const empty = makeInMemoryStore()
    await expect(getToken('https://m', empty)).resolves.toBe('tok_env')
  })

  it('blank OCM_TOKEN falls through to the store', async () => {
    process.env[TOKEN_ENV] = '   '
    const store = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', store)).resolves.toBe('tok_stored')
    expect(store.calls.get).toEqual(['https://m'])
  })

  it.each([
    ['  tok_env  ', 'tok_env'],
    ['   ', null],
    [undefined, null],
  ])('envToken reports %s as %s', (value, expected) => {
    if (value === undefined) delete process.env[TOKEN_ENV]
    else process.env[TOKEN_ENV] = value
    expect(envToken()).toBe(expected)
  })

  it('setToken never writes the env', async () => {
    process.env[TOKEN_ENV] = 'tok_env'
    const store = makeInMemoryStore()
    await setToken('https://m', 'tok_new', store)
    expect(process.env[TOKEN_ENV]).toBe('tok_env')
    expect(store.calls.set).toEqual([{ account: 'https://m', token: 'tok_new' }])
  })

  it('setToken trims the token before storing', async () => {
    const store = makeInMemoryStore()
    await setToken('https://m', '  tok  ', store)
    expect(store.calls.set).toEqual([{ account: 'https://m', token: 'tok' }])
  })

  it('setToken rejects an empty token without touching the store', async () => {
    const store = makeInMemoryStore()
    await expect(setToken('https://m', '   ', store)).rejects.toThrow(TokenStoreError)
    expect(store.calls.set).toEqual([])
  })

  it('deleteToken delegates to the store', async () => {
    const store = makeInMemoryStore({ 'https://m': 'tok' })
    await expect(deleteToken('https://m', store)).resolves.toBe(true)
    await expect(deleteToken('https://other', store)).resolves.toBe(false)
    expect(store.calls.delete).toEqual(['https://m', 'https://other'])
  })

  it('hasStoredToken reports a stored token', async () => {
    const store = makeInMemoryStore({ 'https://m': 'tok' })
    await expect(hasStoredToken('https://m', store)).resolves.toBe(true)
    await expect(hasStoredToken('https://other', store)).resolves.toBe(false)
  })

  it('hasStoredToken reports true from the env override without an account', async () => {
    process.env[TOKEN_ENV] = 'tok_env'
    const store = makeInMemoryStore()
    await expect(hasStoredToken(undefined, store)).resolves.toBe(true)
    expect(store.calls.get).toEqual([])
  })

  it('hasStoredToken reports false without an account and without the env override', async () => {
    const store = makeInMemoryStore({ 'https://m': 'tok' })
    await expect(hasStoredToken(undefined, store)).resolves.toBe(false)
    expect(store.calls.get).toEqual([])
  })

  it('hasStoredToken propagates a store failure', async () => {
    const store = makeFailingStore(new TokenStoreError('keychain locked', 'keychain'))
    await expect(hasStoredToken('https://m', store)).rejects.toThrow(TokenStoreError)
  })

  it('hasStoredToken prefers the env override over a failing store', async () => {
    process.env[TOKEN_ENV] = 'tok_env'
    const store = makeFailingStore(new TokenStoreError('keychain locked', 'keychain'))
    await expect(hasStoredToken('https://m', store)).resolves.toBe(true)
  })

  it('describeTokenStore reports env when OCM_TOKEN is set', () => {
    process.env[TOKEN_ENV] = 'tok_env'
    const store = makeInMemoryStore()
    expect(describeTokenStore(store)).toEqual({ kind: 'env', location: TOKEN_ENV })
  })

  it('describeTokenStore reports the store when OCM_TOKEN is unset', () => {
    const store = makeInMemoryStore()
    expect(describeTokenStore(store)).toEqual({ kind: 'file', location: '<in-memory>' })
  })

  it.each([
    ['set', 'tok_env'],
    ['unset', undefined],
  ])('describeTokenWriteTarget reports the store when OCM_TOKEN is %s', (_label, envValue) => {
    if (envValue === undefined) delete process.env[TOKEN_ENV]
    else process.env[TOKEN_ENV] = envValue
    const store = makeInMemoryStore()
    expect(describeTokenWriteTarget(store)).toEqual({ kind: 'file', location: '<in-memory>' })
  })
})
