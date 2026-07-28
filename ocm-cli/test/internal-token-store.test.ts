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

const TOKEN_ENV_NAME = TOKEN_ENV

function makeInMemoryStore(seed: Record<string, string> = {}): TokenStore & {
  calls: { get: string[]; set: Array<{ account: string; token: string }>; delete: string[] }
} {
  const tokens = { ...seed }
  const calls = { get: [] as string[], set: [] as Array<{ account: string; token: string }>, delete: [] as string[] }
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
  const savedToken = process.env[TOKEN_ENV_NAME]

  beforeEach(() => {
    delete process.env[TOKEN_ENV_NAME]
  })

  afterEach(() => {
    if (savedToken === undefined) delete process.env[TOKEN_ENV_NAME]
    else process.env[TOKEN_ENV_NAME] = savedToken
  })

  describe('selectTokenStore', () => {
    it('uses the keychain store on darwin', () => {
      expect(selectTokenStore('darwin').describe().kind).toBe('keychain')
    })

    it('uses the file store on linux', () => {
      expect(selectTokenStore('linux').describe().kind).toBe('file')
    })

    it('uses the file store on win32', () => {
      expect(selectTokenStore('win32').describe().kind).toBe('file')
    })
  })

  it('getToken returns the stored token', async () => {
    const store = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', store)).resolves.toBe('tok_stored')
    expect(store.calls.get).toEqual(['https://m'])
  })

  it('OCM_TOKEN wins over the store', async () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', store)).resolves.toBe('tok_env')
    expect(store.calls.get).toEqual([])
  })

  it('OCM_TOKEN is used when the store is empty', async () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeInMemoryStore()
    await expect(getToken('https://m', store)).resolves.toBe('tok_env')
    expect(store.calls.get).toEqual([])
  })

  it('blank OCM_TOKEN falls through to the store', async () => {
    process.env[TOKEN_ENV_NAME] = '   '
    const store = makeInMemoryStore({ 'https://m': 'tok_stored' })
    await expect(getToken('https://m', store)).resolves.toBe('tok_stored')
    expect(store.calls.get).toEqual(['https://m'])
  })

  it('envToken reports the trimmed override', () => {
    process.env[TOKEN_ENV_NAME] = '  tok_env  '
    expect(envToken()).toBe('tok_env')
  })

  it('envToken reports null when the override is blank', () => {
    process.env[TOKEN_ENV_NAME] = '   '
    expect(envToken()).toBeNull()
  })

  it('setToken never writes the env', async () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeInMemoryStore()
    await setToken('https://m', 'tok_new', store)
    expect(process.env[TOKEN_ENV_NAME]).toBe('tok_env')
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
    process.env[TOKEN_ENV_NAME] = 'tok_env'
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
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeFailingStore(new TokenStoreError('keychain locked', 'keychain'))
    await expect(hasStoredToken('https://m', store)).resolves.toBe(true)
  })

  it('describeTokenStore reports env when OCM_TOKEN is set', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeInMemoryStore()
    expect(describeTokenStore(store)).toEqual({ kind: 'env', location: TOKEN_ENV_NAME })
  })

  it('describeTokenStore reports the store when OCM_TOKEN is unset', () => {
    const store = makeInMemoryStore()
    expect(describeTokenStore(store)).toEqual({ kind: 'file', location: '<in-memory>' })
  })

  it('describeTokenWriteTarget reports the store even when OCM_TOKEN is set', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const store = makeInMemoryStore()
    expect(describeTokenWriteTarget(store)).toEqual({ kind: 'file', location: '<in-memory>' })
  })

  it('describeTokenWriteTarget reports the store when OCM_TOKEN is unset', () => {
    const store = makeInMemoryStore()
    expect(describeTokenWriteTarget(store)).toEqual({ kind: 'file', location: '<in-memory>' })
  })
})
