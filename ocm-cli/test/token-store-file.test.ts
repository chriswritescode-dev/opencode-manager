import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileTokenStore } from '../src/token-store-file.js'
import { TokenStoreError } from '../src/token-store.js'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocm-cred-'))
  file = join(dir, 'credentials.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function expectFileStoreError(run: () => Promise<unknown>, messagePart?: string) {
  const err = await run().then(() => null, (caught: unknown) => caught)
  expect(err).toBeInstanceOf(TokenStoreError)
  const storeError = err as TokenStoreError
  expect(storeError.kind).toBe('file')
  if (messagePart) expect(storeError.message).toContain(messagePart)
  return storeError
}

describe('file token store', () => {
  it('reads back a token that was stored for an account', async () => {
    const store = createFileTokenStore(file)

    await store.set('https://manager.example.com', 'tok_abc123')

    await expect(store.get('https://manager.example.com')).resolves.toBe('tok_abc123')
  })

  it('keeps tokens isolated per account', async () => {
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')
    await store.set('https://b', 'tok_b')

    await expect(store.get('https://a')).resolves.toBe('tok_a')
    await expect(store.get('https://b')).resolves.toBe('tok_b')
  })

  it('returns null for an unknown account', async () => {
    const store = createFileTokenStore(file)

    await expect(store.get('https://missing')).resolves.toBeNull()
  })

  it('returns null when the file does not exist', async () => {
    const store = createFileTokenStore(join(dir, 'absent.json'))

    await expect(store.get('https://a')).resolves.toBeNull()
  })

  it('overwrites an existing token for the same account', async () => {
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_old')
    await store.set('https://a', 'tok_new')

    await expect(store.get('https://a')).resolves.toBe('tok_new')
  })

  it('deletes only the requested account', async () => {
    const store = createFileTokenStore(file)
    await store.set('https://a', 'tok_a')
    await store.set('https://b', 'tok_b')

    await expect(store.delete('https://a')).resolves.toBe(true)

    await expect(store.get('https://a')).resolves.toBeNull()
    await expect(store.get('https://b')).resolves.toBe('tok_b')
  })

  it('reports false when deleting an account that is not stored', async () => {
    const store = createFileTokenStore(file)

    await expect(store.delete('https://missing')).resolves.toBe(false)
  })

  it('writes the file with owner-only permissions', async () => {
    if (process.platform === 'win32') return
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('creates the parent directory with owner-only permissions', async () => {
    if (process.platform === 'win32') return
    const nested = join(dir, 'nested', 'credentials.json')
    const store = createFileTokenStore(nested)

    await store.set('https://a', 'tok_a')

    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700)
  })

  it('tightens a loose parent directory mode on write', async () => {
    if (process.platform === 'win32') return
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('repairs loose permissions on an existing file', async () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{}', { mode: 0o644 })
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('tolerates a corrupt file on read', async () => {
    writeFileSync(file, 'not json', { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://a')).resolves.toBeNull()
  })

  it('recovers a corrupt file on write', async () => {
    writeFileSync(file, 'not json', { mode: 0o600 })
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    await expect(store.get('https://a')).resolves.toBe('tok_a')
  })

  it('does not leave a temp file behind after a write', async () => {
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    expect(readdirSync(dir).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('creates the parent directory when it does not exist', async () => {
    const nested = join(dir, 'nested', 'credentials.json')
    const store = createFileTokenStore(nested)

    await store.set('https://a', 'tok_a')

    await expect(store.get('https://a')).resolves.toBe('tok_a')
  })

  it('describes its file location', () => {
    const store = createFileTokenStore(file)

    expect(store.describe()).toEqual({ kind: 'file', location: file })
  })

  it('treats an array-valued tokens map as corrupt and recovers on write', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: [] }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://a')).resolves.toBeNull()

    await store.set('https://a', 'tok_a')

    await expect(store.get('https://a')).resolves.toBe('tok_a')
  })

  it('refuses to read a document written by an unsupported future version', async () => {
    writeFileSync(file, JSON.stringify({ version: 2, tokens: { 'https://a': 'tok_a' } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expectFileStoreError(() => store.get('https://a'), 'unsupported format version 2')
  })

  it('refuses to overwrite a document written by an unsupported future version', async () => {
    const future = JSON.stringify({ version: 2, tokens: { 'https://a': 'tok_a' } })
    writeFileSync(file, future, { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expectFileStoreError(() => store.set('https://b', 'tok_b'), 'unsupported format version 2')
    expect(readFileSync(file, 'utf-8')).toBe(future)
  })

  it('refuses to delete from a document written by an unsupported future version', async () => {
    writeFileSync(file, JSON.stringify({ version: 2, tokens: { 'https://a': 'tok_a' } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expectFileStoreError(() => store.delete('https://a'), 'unsupported format version 2')
  })

  it('treats a versionless document as the current version', async () => {
    writeFileSync(file, JSON.stringify({ tokens: { 'https://a': 'tok_a' } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://a')).resolves.toBe('tok_a')
  })

  it('preserves unknown top-level keys when writing', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: {}, futureField: { keep: true } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await store.set('https://a', 'tok_a')

    const written = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    expect(written.futureField).toEqual({ keep: true })
    expect(written.version).toBe(1)
  })

  it('wraps read failures from set as a file TokenStoreError', async () => {
    const store = createFileTokenStore(dir)

    await expectFileStoreError(() => store.set('https://a', 'tok_a'))
  })

  it('wraps read failures from delete as a file TokenStoreError', async () => {
    const store = createFileTokenStore(dir)

    await expectFileStoreError(() => store.delete('https://a'))
  })

  it('throws a TokenStoreError naming the file and cause when the file is unreadable', async () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{}', { mode: 0o000 })
    const store = createFileTokenStore(file)

    const err = await expectFileStoreError(() => store.get('https://a'), 'failed to read token file')
    expect(err.message).toContain(file)
  })

  it('does not treat an unreadable file as missing', async () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{"version":1,"tokens":{"https://a":"tok_a"}}', { mode: 0o000 })
    const store = createFileTokenStore(file)

    await expectFileStoreError(() => store.get('https://a'))
  })

  it('treats an object-valued token as missing without throwing', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': {} } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://m')).resolves.toBeNull()
  })

  it('treats a number-valued token as missing without throwing', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': 42 } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://m')).resolves.toBeNull()
  })

  it('treats a boolean-valued token as missing without throwing', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': true } }), { mode: 0o600 })
    const store = createFileTokenStore(file)

    await expect(store.get('https://m')).resolves.toBeNull()
  })

  it('preserves string siblings alongside malformed token values', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, tokens: { 'https://m': {}, 'https://ok': 'tok_ok' } }),
      { mode: 0o600 },
    )
    const store = createFileTokenStore(file)

    await expect(store.get('https://m')).resolves.toBeNull()
    await expect(store.get('https://ok')).resolves.toBe('tok_ok')
  })

  it('drops malformed token values when writing a new token over the document', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, tokens: { 'https://m': {} } }),
      { mode: 0o600 },
    )
    const store = createFileTokenStore(file)

    await store.set('https://m', 'tok_real')

    await expect(store.get('https://m')).resolves.toBe('tok_real')
    const written = JSON.parse(readFileSync(file, 'utf-8')) as { tokens: Record<string, unknown> }
    expect(typeof written.tokens['https://m']).toBe('string')
  })
})
