import type { CredentialBackend, CredentialStoreDescription } from './credential-backend.js'
import { CredentialStoreError } from './credential-backend.js'
import { createFileCredentialBackend } from './credential-file.js'
import { createKeychainCredentialBackend } from './credential-keychain.js'

export const TOKEN_ENV = 'OCM_TOKEN'

export function selectCredentialBackend(
  platform: NodeJS.Platform = process.platform,
): CredentialBackend {
  return platform === 'darwin'
    ? createKeychainCredentialBackend()
    : createFileCredentialBackend()
}

let active: CredentialBackend | undefined
function defaultBackend(): CredentialBackend {
  active ??= selectCredentialBackend()
  return active
}

function envToken(): string | null {
  const raw = process.env[TOKEN_ENV]?.trim()
  return raw ? raw : null
}

export function getToken(
  account: string,
  backend: CredentialBackend = defaultBackend(),
): string | null {
  return envToken() ?? backend.get(account)
}

export function setToken(
  account: string,
  token: string,
  backend: CredentialBackend = defaultBackend(),
): void {
  const normalised = token.trim()
  if (!normalised) throw new CredentialStoreError('refusing to store an empty token', backend.kind)
  backend.set(account, normalised)
}

export function deleteToken(
  account: string,
  backend: CredentialBackend = defaultBackend(),
): boolean {
  return backend.delete(account)
}

export function describeCredentialStore(
  backend: CredentialBackend = defaultBackend(),
): CredentialStoreDescription {
  return envToken() ? { kind: 'env', location: TOKEN_ENV } : backend.describe()
}

export function describeBackendStore(
  backend: CredentialBackend = defaultBackend(),
): CredentialStoreDescription {
  return backend.describe()
}

export { CredentialStoreError } from './credential-backend.js'
export type { CredentialBackend, CredentialBackendKind, CredentialStoreDescription } from './credential-backend.js'
