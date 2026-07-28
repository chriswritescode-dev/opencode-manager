export type CredentialBackendKind = 'env' | 'keychain' | 'file'

export interface CredentialStoreDescription {
  kind: CredentialBackendKind
  location: string
}

export interface CredentialBackend {
  readonly kind: CredentialBackendKind
  describe(): CredentialStoreDescription
  get(account: string): string | null
  set(account: string, token: string): void
  delete(account: string): boolean
}

export class CredentialStoreError extends Error {
  constructor(message: string, public kind: CredentialBackendKind) {
    super(message)
    this.name = 'CredentialStoreError'
  }
}
