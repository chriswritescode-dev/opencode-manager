import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileCredentialBackend } from '../src/credential-file.js'
import { CredentialStoreError } from '../src/credential-backend.js'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocm-cred-'))
  file = join(dir, 'credentials.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('file credential backend', () => {
  it('reads back a token that was stored for an account', () => {
    const backend = createFileCredentialBackend(file)

    backend.set('https://manager.example.com', 'tok_abc123')

    expect(backend.get('https://manager.example.com')).toBe('tok_abc123')
  })

  it('keeps tokens isolated per account', () => {
    const backend = createFileCredentialBackend(file)

    backend.set('https://a', 'tok_a')
    backend.set('https://b', 'tok_b')

    expect(backend.get('https://a')).toBe('tok_a')
    expect(backend.get('https://b')).toBe('tok_b')
  })

  it('returns null for an unknown account', () => {
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://nope')).toBeNull()
  })

  it('returns null and does not throw or create the file when the file is missing', () => {
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://manager.example.com')).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('deletes an existing account and reports true', () => {
    const backend = createFileCredentialBackend(file)
    backend.set('https://a', 'tok_a')

    expect(backend.delete('https://a')).toBe(true)
    expect(backend.get('https://a')).toBeNull()
  })

  it('reports false when deleting an unknown account', () => {
    const backend = createFileCredentialBackend(file)

    expect(backend.delete('https://never-stored')).toBe(false)
  })

  it('preserves sibling tokens when deleting an account', () => {
    const backend = createFileCredentialBackend(file)
    backend.set('https://a', 'tok_a')
    backend.set('https://b', 'tok_b')

    backend.delete('https://a')

    expect(backend.get('https://b')).toBe('tok_b')
  })

  it('writes the credentials file with mode 0600', () => {
    if (process.platform === 'win32') return
    const backend = createFileCredentialBackend(file)

    backend.set('https://a', 'tok_a')

    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('repairs loose permissions on an existing file', () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{}', { mode: 0o644 })
    const backend = createFileCredentialBackend(file)

    backend.set('https://a', 'tok_a')

    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('tolerates a corrupt file on read', () => {
    writeFileSync(file, 'not json', { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://a')).toBeNull()
  })

  it('recovers a corrupt file on write', () => {
    writeFileSync(file, 'not json', { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    backend.set('https://a', 'tok_a')

    expect(backend.get('https://a')).toBe('tok_a')
  })

  it('does not leave a temp file behind after a write', () => {
    const backend = createFileCredentialBackend(file)

    backend.set('https://a', 'tok_a')

    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('creates the parent directory when it does not exist', () => {
    const nested = join(dir, 'nested', 'credentials.json')
    const backend = createFileCredentialBackend(nested)

    backend.set('https://a', 'tok_a')

    expect(backend.get('https://a')).toBe('tok_a')
  })

  it('describes its file location', () => {
    const backend = createFileCredentialBackend(file)

    expect(backend.describe()).toEqual({ kind: 'file', location: file })
  })

  it('treats an array-valued tokens map as corrupt and recovers on write', () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: [] }), { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://a')).toBeNull()

    backend.set('https://a', 'tok_a')

    expect(backend.get('https://a')).toBe('tok_a')
  })

  it('wraps read failures from set as a file CredentialStoreError', () => {
    const backend = createFileCredentialBackend(dir)

    expect(() => backend.set('https://a', 'tok_a')).toThrow(CredentialStoreError)
    try {
      backend.set('https://a', 'tok_a')
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialStoreError)
      expect((err as CredentialStoreError).kind).toBe('file')
    }
  })

  it('wraps read failures from delete as a file CredentialStoreError', () => {
    const backend = createFileCredentialBackend(dir)

    expect(() => backend.delete('https://a')).toThrow(CredentialStoreError)
    try {
      backend.delete('https://a')
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialStoreError)
      expect((err as CredentialStoreError).kind).toBe('file')
    }
  })

  it('throws a CredentialStoreError naming the file and cause when the file is unreadable', () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{}', { mode: 0o000 })
    const backend = createFileCredentialBackend(file)

    expect(() => backend.get('https://a')).toThrow(CredentialStoreError)
    try {
      backend.get('https://a')
    } catch (err) {
      const e = err as CredentialStoreError
      expect(e).toBeInstanceOf(CredentialStoreError)
      expect(e.kind).toBe('file')
      expect(e.message).toContain(file)
      expect(e.message).toContain('failed to read credential file')
    }
  })

  it('does not treat an unreadable file as missing', () => {
    if (process.platform === 'win32') return
    writeFileSync(file, '{"version":1,"tokens":{"https://a":"tok_a"}}', { mode: 0o000 })
    const backend = createFileCredentialBackend(file)

    expect(() => backend.get('https://a')).toThrow(CredentialStoreError)
  })

  it('treats an object-valued token as missing without throwing', () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': {} } }), { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://m')).toBeNull()
  })

  it('treats a number-valued token as missing without throwing', () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': 42 } }), { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://m')).toBeNull()
  })

  it('treats a boolean-valued token as missing without throwing', () => {
    writeFileSync(file, JSON.stringify({ version: 1, tokens: { 'https://m': true } }), { mode: 0o600 })
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://m')).toBeNull()
  })

  it('preserves string siblings alongside malformed token values', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, tokens: { 'https://m': {}, 'https://ok': 'tok_ok' } }),
      { mode: 0o600 },
    )
    const backend = createFileCredentialBackend(file)

    expect(backend.get('https://m')).toBeNull()
    expect(backend.get('https://ok')).toBe('tok_ok')
  })

  it('drops malformed token values when writing a new token over the document', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, tokens: { 'https://m': {} } }),
      { mode: 0o600 },
    )
    const backend = createFileCredentialBackend(file)

    backend.set('https://m', 'tok_real')

    expect(backend.get('https://m')).toBe('tok_real')
    const written = JSON.parse(readFileSync(file, 'utf-8'))
    expect(typeof written.tokens['https://m']).toBe('string')
  })
})
