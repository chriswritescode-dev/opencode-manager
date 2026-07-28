import type { TokenStore, TokenStoreDescription } from './token-store.js'
import { TokenStoreError } from './token-store.js'
import { createFileTokenStore } from './token-store-file.js'
import { createKeychainTokenStore } from './token-store-keychain.js'

export const TOKEN_ENV = 'OCM_TOKEN'

export function selectTokenStore(platform: NodeJS.Platform = process.platform): TokenStore {
  return platform === 'darwin'
    ? createKeychainTokenStore()
    : createFileTokenStore()
}

function memoizeReads(store: TokenStore): TokenStore {
  const cache = new Map<string, string>()
  return {
    describe: () => store.describe(),
    async get(account: string): Promise<string | null> {
      const cached = cache.get(account)
      if (cached) return cached
      const token = await store.get(account)
      if (token) cache.set(account, token)
      return token
    },
    async set(account: string, token: string): Promise<void> {
      await store.set(account, token)
      cache.set(account, token)
    },
    async delete(account: string): Promise<boolean> {
      cache.delete(account)
      return store.delete(account)
    },
  }
}

let active: TokenStore | undefined
function defaultStore(): TokenStore {
  active ??= memoizeReads(selectTokenStore())
  return active
}

export function envToken(): string | null {
  const raw = process.env[TOKEN_ENV]?.trim()
  return raw ? raw : null
}

export async function getToken(
  account: string,
  store: TokenStore = defaultStore(),
): Promise<string | null> {
  return envToken() ?? (await store.get(account))
}

export async function setToken(
  account: string,
  token: string,
  store: TokenStore = defaultStore(),
): Promise<void> {
  const normalised = token.trim()
  if (!normalised) {
    throw new TokenStoreError('refusing to store an empty token', store.describe().kind)
  }
  await store.set(account, normalised)
}

export async function deleteToken(
  account: string,
  store: TokenStore = defaultStore(),
): Promise<boolean> {
  return store.delete(account)
}

export async function hasStoredToken(
  account: string | undefined,
  store: TokenStore = defaultStore(),
): Promise<boolean> {
  if (envToken()) return true
  if (!account) return false
  return (await store.get(account)) !== null
}

export function describeTokenStore(
  store: TokenStore = defaultStore(),
): TokenStoreDescription {
  return envToken() ? { kind: 'env', location: TOKEN_ENV } : store.describe()
}

export function describeTokenWriteTarget(
  store: TokenStore = defaultStore(),
): TokenStoreDescription {
  return store.describe()
}

export { TokenStoreError } from './token-store.js'
