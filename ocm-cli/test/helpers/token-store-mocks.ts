import { vi } from 'vitest'
import type { OcmState } from '../../src/state.js'
import type { TokenStoreDescription } from '../../src/token-store.js'

export class MockTokenStoreError extends Error {
  constructor(message: string, public kind = 'file') {
    super(message)
    this.name = 'TokenStoreError'
  }
}

const DEFAULT_STORE: TokenStoreDescription = { kind: 'file', location: '/tmp/credentials.json' }

export interface TokenStoreMockOptions {
  token?: string | null
  getTokenImpl?: (account: string) => Promise<string | null>
  setTokenImpl?: (account: string, token: string) => Promise<void>
  deleteTokenImpl?: (account: string) => Promise<boolean>
  store?: TokenStoreDescription
  writeTarget?: TokenStoreDescription
  env?: string | null
}

export function mockStateModule(state: OcmState | null = { managerUrl: 'https://manager.example.com' }) {
  const clearState = vi.fn()
  vi.doMock('../../src/state.js', () => ({
    readState: () => state,
    writeState: () => {},
    clearState,
    getStatePath: () => '/tmp/state.json',
    getConfigDir: () => '/tmp',
  }))
  return { clearState }
}

export function mockTokenStoreModule(options: TokenStoreMockOptions = {}) {
  const envValue = options.env ?? null
  const getToken = vi.fn<(account: string) => Promise<string | null>>(
    options.getTokenImpl ?? (() => Promise.resolve(options.token ?? null)),
  )
  const setToken = vi.fn<(account: string, token: string) => Promise<void>>(
    options.setTokenImpl ?? (() => Promise.resolve()),
  )
  const deleteToken = vi.fn<(account: string) => Promise<boolean>>(
    options.deleteTokenImpl ?? (() => Promise.resolve(true)),
  )
  const store = options.store ?? DEFAULT_STORE
  vi.doMock('../../src/internal-token-store.js', () => ({
    TOKEN_ENV: 'OCM_TOKEN',
    envToken: () => envValue,
    getToken,
    setToken,
    deleteToken,
    hasStoredToken: async (account: string | undefined) => {
      if (envValue) return true
      if (!account) return false
      return (await getToken(account)) !== null
    },
    describeTokenStore: () => (envValue ? { kind: 'env', location: 'OCM_TOKEN' } : store),
    describeTokenWriteTarget: () => options.writeTarget ?? store,
    TokenStoreError: MockTokenStoreError,
  }))
  return { getToken, setToken, deleteToken }
}

export function unmockTokenStoreModules() {
  vi.doUnmock('../../src/state.js')
  vi.doUnmock('../../src/internal-token-store.js')
}
