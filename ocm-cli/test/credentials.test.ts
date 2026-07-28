import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TOKEN_ENV,
  selectCredentialBackend,
  getToken,
  setToken,
  deleteToken,
  describeCredentialStore,
  describeBackendStore,
  CredentialStoreError,
} from '../src/credentials.js'
import type { CredentialBackend } from '../src/credential-backend.js'

const TOKEN_ENV_NAME = TOKEN_ENV

function makeInMemoryBackend(seed: Record<string, string> = {}): CredentialBackend & {
  calls: { get: string[]; set: Array<{ account: string; token: string }>; delete: string[] }
} {
  const store = { ...seed }
  const calls = { get: [] as string[], set: [] as Array<{ account: string; token: string }>, delete: [] as string[] }
  return {
    kind: 'file',
    describe: () => ({ kind: 'file', location: '<in-memory>' }),
    get(account: string) {
      calls.get.push(account)
      return store[account] ?? null
    },
    set(account: string, token: string) {
      calls.set.push({ account, token })
      store[account] = token
    },
    delete(account: string) {
      calls.delete.push(account)
      if (!(account in store)) return false
      delete store[account]
      return true
    },
    calls,
  }
}

describe('credentials facade', () => {
  const savedToken = process.env[TOKEN_ENV_NAME]

  beforeEach(() => {
    delete process.env[TOKEN_ENV_NAME]
  })

  afterEach(() => {
    if (savedToken === undefined) delete process.env[TOKEN_ENV_NAME]
    else process.env[TOKEN_ENV_NAME] = savedToken
  })

  describe('selectCredentialBackend', () => {
    it('uses the keychain backend on darwin', () => {
      expect(selectCredentialBackend('darwin').kind).toBe('keychain')
    })

    it('uses the file backend on linux', () => {
      expect(selectCredentialBackend('linux').kind).toBe('file')
    })

    it('uses the file backend on win32', () => {
      expect(selectCredentialBackend('win32').kind).toBe('file')
    })
  })

  it('getToken returns the stored token', () => {
    const backend = makeInMemoryBackend({ 'https://m': 'tok_stored' })
    expect(getToken('https://m', backend)).toBe('tok_stored')
    expect(backend.calls.get).toEqual(['https://m'])
  })

  it('OCM_TOKEN wins over the backend', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const backend = makeInMemoryBackend({ 'https://m': 'tok_stored' })
    expect(getToken('https://m', backend)).toBe('tok_env')
    expect(backend.calls.get).toEqual([])
  })

  it('OCM_TOKEN is used when the backend is empty', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const backend = makeInMemoryBackend()
    expect(getToken('https://m', backend)).toBe('tok_env')
    expect(backend.calls.get).toEqual([])
  })

  it('blank OCM_TOKEN falls through to the backend', () => {
    process.env[TOKEN_ENV_NAME] = '   '
    const backend = makeInMemoryBackend({ 'https://m': 'tok_stored' })
    expect(getToken('https://m', backend)).toBe('tok_stored')
    expect(backend.calls.get).toEqual(['https://m'])
  })

  it('setToken never writes the env', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const backend = makeInMemoryBackend()
    setToken('https://m', 'tok_new', backend)
    expect(process.env[TOKEN_ENV_NAME]).toBe('tok_env')
    expect(backend.calls.set).toEqual([{ account: 'https://m', token: 'tok_new' }])
  })

  it('setToken trims the token before storing', () => {
    const backend = makeInMemoryBackend()
    setToken('https://m', '  tok  ', backend)
    expect(backend.calls.set).toEqual([{ account: 'https://m', token: 'tok' }])
  })

  it('setToken rejects an empty token without touching the backend', () => {
    const backend = makeInMemoryBackend()
    expect(() => setToken('https://m', '   ', backend)).toThrow(CredentialStoreError)
    expect(backend.calls.set).toEqual([])
  })

  it('deleteToken delegates to the backend', () => {
    const backend = makeInMemoryBackend({ 'https://m': 'tok' })
    expect(deleteToken('https://m', backend)).toBe(true)
    expect(deleteToken('https://other', backend)).toBe(false)
    expect(backend.calls.delete).toEqual(['https://m', 'https://other'])
  })

  it('describeCredentialStore reports env when OCM_TOKEN is set', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const backend = makeInMemoryBackend()
    expect(describeCredentialStore(backend)).toEqual({ kind: 'env', location: TOKEN_ENV_NAME })
  })

  it('describeCredentialStore reports the backend when OCM_TOKEN is unset', () => {
    const backend = makeInMemoryBackend()
    expect(describeCredentialStore(backend)).toEqual({ kind: 'file', location: '<in-memory>' })
  })

  it('describeBackendStore reports the backend even when OCM_TOKEN is set', () => {
    process.env[TOKEN_ENV_NAME] = 'tok_env'
    const backend = makeInMemoryBackend()
    expect(describeBackendStore(backend)).toEqual({ kind: 'file', location: '<in-memory>' })
  })

  it('describeBackendStore reports the backend when OCM_TOKEN is unset', () => {
    const backend = makeInMemoryBackend()
    expect(describeBackendStore(backend)).toEqual({ kind: 'file', location: '<in-memory>' })
  })
})
