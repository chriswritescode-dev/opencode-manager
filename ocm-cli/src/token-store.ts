export type TokenStoreKind = 'env' | 'keychain' | 'file'

export interface TokenStoreDescription {
  kind: TokenStoreKind
  location: string
}

export interface TokenStore {
  describe(): TokenStoreDescription
  get(account: string): Promise<string | null>
  set(account: string, token: string): Promise<void>
  delete(account: string): Promise<boolean>
}

export class TokenStoreError extends Error {
  constructor(message: string, public kind: TokenStoreKind) {
    super(message)
    this.name = 'TokenStoreError'
  }
}

export function describeCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
