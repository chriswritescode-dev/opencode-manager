import { join } from 'path'
import { z } from 'zod'
import { JsonObjectSchema, JsonValueSchema, type JsonValue } from '@opencode-manager/shared/utils'
import { getConfigDir } from './state.js'
import { readJsonFile, writeJsonFileAtomic } from './json-store.js'
import type { TokenStore, TokenStoreDescription } from './token-store.js'
import { TokenStoreError, describeCause } from './token-store.js'

const DOCUMENT_VERSION = 1

interface TokenDocument {
  version: number
  tokens: Record<string, string>
  [key: string]: JsonValue
}

function tokenFilePath(): string {
  return join(getConfigDir(), 'credentials.json')
}

function readDocument(filePath: string): TokenDocument {
  let content: JsonValue | null
  try {
    content = readJsonFile(filePath, JsonValueSchema)
  } catch (cause) {
    throw new TokenStoreError(`failed to read token file ${filePath}: ${describeCause(cause)}`, 'file')
  }
  const empty: TokenDocument = { version: DOCUMENT_VERSION, tokens: {} }
  const parsed = JsonObjectSchema.safeParse(content)
  if (!parsed.success) return empty
  const raw = parsed.data
  if (raw.version !== undefined && raw.version !== DOCUMENT_VERSION) {
    throw new TokenStoreError(
      `token file ${filePath} uses unsupported format version ${JSON.stringify(raw.version)}; upgrade ocm or remove the file`,
      'file',
    )
  }
  const tokens: Record<string, string> = {}
  const storedTokens = JsonObjectSchema.safeParse(raw.tokens)
  if (storedTokens.success) {
    for (const [account, token] of Object.entries(storedTokens.data)) {
      const value = z.string().safeParse(token)
      if (value.success) tokens[account] = value.data
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
  } catch (cause) {
    if (cause instanceof TokenStoreError) throw cause
    throw new TokenStoreError(`failed to write token file ${filePath}: ${describeCause(cause)}`, 'file')
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
