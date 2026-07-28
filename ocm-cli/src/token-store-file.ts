import { join } from 'path'
import { getConfigDir } from './state.js'
import { readJsonFile, writeJsonFileAtomic } from './json-store.js'
import type { TokenStore, TokenStoreDescription } from './token-store.js'
import { TokenStoreError, describeCause } from './token-store.js'

const DOCUMENT_VERSION = 1

type TokenDocument = Record<string, unknown> & {
  version: number
  tokens: Record<string, string>
}

function tokenFilePath(): string {
  return join(getConfigDir(), 'credentials.json')
}

function readDocument(filePath: string): TokenDocument {
  let raw: Record<string, unknown> | null
  try {
    raw = readJsonFile<Record<string, unknown>>(filePath)
  } catch (err) {
    throw new TokenStoreError(`failed to read token file ${filePath}: ${describeCause(err)}`, 'file')
  }
  const empty: TokenDocument = { version: DOCUMENT_VERSION, tokens: {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
  if (raw.version !== undefined && raw.version !== DOCUMENT_VERSION) {
    throw new TokenStoreError(
      `token file ${filePath} uses unsupported format version ${JSON.stringify(raw.version)}; upgrade ocm or remove the file`,
      'file',
    )
  }
  const tokens: Record<string, string> = {}
  if (raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens)) {
    for (const [account, token] of Object.entries(raw.tokens as Record<string, unknown>)) {
      if (typeof token === 'string') tokens[account] = token
    }
  }
  return { ...raw, version: DOCUMENT_VERSION, tokens }
}

function mutateDocument(filePath: string, mutate: (tokens: Record<string, string>) => boolean): boolean {
  try {
    const doc = readDocument(filePath)
    if (!mutate(doc.tokens)) return false
    writeJsonFileAtomic(filePath, doc)
    return true
  } catch (err) {
    if (err instanceof TokenStoreError) throw err
    throw new TokenStoreError(`failed to write token file ${filePath}: ${describeCause(err)}`, 'file')
  }
}

export function createFileTokenStore(filePath: string = tokenFilePath()): TokenStore {
  return {
    describe(): TokenStoreDescription {
      return { kind: 'file', location: filePath }
    },
    async get(account: string): Promise<string | null> {
      return readDocument(filePath).tokens[account] ?? null
    },
    async set(account: string, token: string): Promise<void> {
      mutateDocument(filePath, (tokens) => {
        tokens[account] = token
        return true
      })
    },
    async delete(account: string): Promise<boolean> {
      return mutateDocument(filePath, (tokens) => {
        if (!(account in tokens)) return false
        delete tokens[account]
        return true
      })
    },
  }
}
