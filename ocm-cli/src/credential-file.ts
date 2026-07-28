import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getConfigDir } from './state.js'
import type { CredentialBackend, CredentialStoreDescription } from './credential-backend.js'
import { CredentialStoreError } from './credential-backend.js'

interface CredentialDocument {
  version: 1
  tokens: Record<string, string>
}

export function defaultCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json')
}

function readDocument(filePath: string): CredentialDocument {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf-8')
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, tokens: {} }
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new CredentialStoreError(`failed to read credential file ${filePath}: ${message}`, 'file')
  }
  if (contents.trim() === '') return { version: 1, tokens: {} }
  try {
    const parsed = JSON.parse(contents) as Partial<CredentialDocument>
    if (!parsed || typeof parsed !== 'object' || !parsed.tokens || typeof parsed.tokens !== 'object' || Array.isArray(parsed.tokens)) {
      return { version: 1, tokens: {} }
    }
    const tokens: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.tokens as Record<string, unknown>)) {
      if (typeof value === 'string') tokens[key] = value
    }
    return { version: 1, tokens }
  } catch {
    return { version: 1, tokens: {} }
  }
}

function writeDocument(filePath: string, doc: CredentialDocument): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(doc, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
}

export function createFileCredentialBackend(filePath: string = defaultCredentialsPath()): CredentialBackend {
  return {
    kind: 'file',
    describe(): CredentialStoreDescription {
      return { kind: 'file', location: filePath }
    },
    get(account: string): string | null {
      const doc = readDocument(filePath)
      return doc.tokens[account] ?? null
    },
    set(account: string, token: string): void {
      try {
        const doc = readDocument(filePath)
        doc.tokens[account] = token
        writeDocument(filePath, doc)
      } catch (err) {
        if (err instanceof CredentialStoreError) throw err
        const message = err instanceof Error ? err.message : String(err)
        throw new CredentialStoreError(`failed to write credential file ${filePath}: ${message}`, 'file')
      }
    },
    delete(account: string): boolean {
      try {
        const doc = readDocument(filePath)
        if (!(account in doc.tokens)) return false
        delete doc.tokens[account]
        writeDocument(filePath, doc)
      } catch (err) {
        if (err instanceof CredentialStoreError) throw err
        const message = err instanceof Error ? err.message : String(err)
        throw new CredentialStoreError(`failed to write credential file ${filePath}: ${message}`, 'file')
      }
      return true
    },
  }
}
