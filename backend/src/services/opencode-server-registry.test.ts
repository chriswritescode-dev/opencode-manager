import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { encryptOpenCodePairingCredentials, verifyOpenCodePairingProof } from '@opencode-manager/shared/opencode'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { decryptSecret } from '../utils/crypto'
import {
  OpenCodeServerCredentialsRequiredError,
  OpenCodeServerError,
  OpenCodeServerNotFoundError,
  OpenCodeServerPairingError,
  OpenCodeServerRegistry,
  type OpenCodeServerChange,
} from './opencode-server-registry'
import { FetchOpenCodeClient, type OpenCodeClient } from './opencode/client'

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

type FetchMock = ReturnType<typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>>

const PAIR_URL = 'https://remote.example.com/pair'
const PAIR_CODE = '0123456789abcdef'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createLocalClient(): OpenCodeClient {
  return { api: {} as OpenCodeClient['api'], forwardRaw: vi.fn() }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function readStoredSecret(db: Database, serverId: string): { value: string } | undefined {
  return db
    .prepare('SELECT value FROM app_secrets WHERE key = ?')
    .get(`opencode_server:${serverId}:password`) as { value: string } | undefined
}

function flipLastByte(value: string): string {
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const last = bytes.length - 1
  bytes[last] = (bytes[last] ?? 0) ^ 0x01
  return bytes.toString('base64url')
}

describe('OpenCodeServerRegistry', () => {
  let db: Database
  let localClient: OpenCodeClient
  let fetchFn: FetchMock
  let registry: OpenCodeServerRegistry

  type CreateInput = Parameters<OpenCodeServerRegistry['create']>[0]

  function createServer(overrides: Partial<CreateInput> = {}): Promise<OpenCodeServer> {
    return registry.create({
      name: 'Studio',
      baseUrl: 'https://studio.example.com',
      username: 'opencode',
      enabled: true,
      ...overrides,
    })
  }

  beforeEach(() => {
    db = createTestDb()
    localClient = createLocalClient()
    fetchFn = vi.fn(async () => jsonResponse({}))
    registry = new OpenCodeServerRegistry(db, localClient, fetchFn as unknown as typeof fetch)
  })

  describe('create', () => {
    it('creates a server with a normalized base URL and an encrypted password', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com/',
        password: 'super-secret',
      })

      expect(server.id).toMatch(/^srv_[A-Za-z0-9_-]+$/)
      expect(server.baseUrl).toBe('https://studio.example.com')
      expect(server.username).toBe('opencode')
      expect(server.enabled).toBe(true)
      expect(server.hasPassword).toBe(true)
      expect(registry.list()).toHaveLength(1)

      const stored = readStoredSecret(db, server.id)
      expect(stored?.value).not.toBe('super-secret')
      expect(decryptSecret(stored!.value)).toBe('super-secret')
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('creates a server without a password when none is provided', async () => {
      const server = await createServer({ name: 'Open', baseUrl: 'http://localhost:4096' })

      expect(server.hasPassword).toBe(false)
      expect(readStoredSecret(db, server.id)).toBeUndefined()
    })

    it('redeems a pairing code and stores the returned credentials', async () => {
      const requests: Array<{ nonce: string; proof: string }> = []
      fetchFn.mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { nonce: string; proof: string }
        requests.push(body)
        return jsonResponse(await encryptOpenCodePairingCredentials({
          code: PAIR_CODE,
          nonce: body.nonce,
          credentials: { username: 'alice', password: 'paired-pass' },
        }))
      })

      const server = await createServer({
        name: 'Paired',
        baseUrl: 'https://remote.example.com',
        username: 'ignored',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      })

      expect(server.username).toBe('alice')
      expect(server.hasPassword).toBe(true)
      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('paired-pass')

      const [url, init] = fetchFn.mock.calls[0]!
      expect(url).toBe(PAIR_URL)
      expect(init?.method).toBe('POST')
      expect(requests).toHaveLength(1)
      expect(Object.keys(requests[0]!).sort()).toEqual(['nonce', 'proof'])
      expect(String(init?.body)).not.toContain(PAIR_CODE)
      await expect(verifyOpenCodePairingProof(PAIR_CODE, requests[0]!.nonce, requests[0]!.proof)).resolves.toBe(true)
    })

    it('rejects a tampered encrypted payload', async () => {
      fetchFn.mockImplementationOnce(async (_url, init) => {
        const { nonce } = JSON.parse(String(init?.body)) as { nonce: string }
        const encrypted = await encryptOpenCodePairingCredentials({
          code: PAIR_CODE,
          nonce,
          credentials: { username: 'alice', password: 'paired-pass' },
        })
        return jsonResponse({ ...encrypted, ciphertext: flipLastByte(encrypted.ciphertext) })
      })

      const error = await createServer({
        name: 'Paired',
        baseUrl: 'https://remote.example.com',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerPairingError)
      expect((error as { status?: number }).status).toBe(502)
      expect(registry.list()).toEqual([])
    })

    it('rejects a response without an encrypted payload', async () => {
      fetchFn.mockResolvedValueOnce(jsonResponse({ username: 'alice', password: 'paired-pass' }))

      const error = await createServer({
        name: 'Paired',
        baseUrl: 'https://remote.example.com',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerPairingError)
      expect(registry.list()).toEqual([])
    })

    it('rejects decrypted credentials with an empty username', async () => {
      fetchFn.mockImplementationOnce(async (_url, init) => {
        const { nonce } = JSON.parse(String(init?.body)) as { nonce: string }
        return jsonResponse(await encryptOpenCodePairingCredentials({
          code: PAIR_CODE,
          nonce,
          credentials: { username: '', password: 'paired-pass' },
        }))
      })

      const error = await createServer({
        name: 'Paired',
        baseUrl: 'https://remote.example.com',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerPairingError)
      expect(registry.list()).toEqual([])
    })

    it('fails with a pairing error when the pairing endpoint rejects the code', async () => {
      fetchFn.mockResolvedValueOnce(new Response(null, { status: 403 }))

      await expect(
        createServer({
          name: 'Paired',
          baseUrl: 'https://remote.example.com',
          pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
        }),
      ).rejects.toMatchObject({ status: 502 })

      expect(registry.list()).toEqual([])
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('fails with a pairing error when the pairing endpoint is unreachable', async () => {
      fetchFn.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

      const error = await createServer({
        name: 'Paired',
        baseUrl: 'https://remote.example.com',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerPairingError)
      expect((error as Error).message).not.toContain(PAIR_CODE)
    })
  })

  describe('update', () => {
    it('updates fields and clears the password when null is sent', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const updated = await registry.update(server.id, { name: 'Renamed', password: null })

      expect(updated.name).toBe('Renamed')
      expect(updated.hasPassword).toBe(false)
      expect(readStoredSecret(db, server.id)).toBeUndefined()
    })

    it('replaces the password when a new one is sent', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      await registry.update(server.id, { password: 'next-secret' })

      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('next-secret')
    })

    it('throws a not-found error for an unknown server', async () => {
      await expect(registry.update('srv_missing', { name: 'Renamed' })).rejects.toBeInstanceOf(
        OpenCodeServerNotFoundError,
      )
    })

    it('rejects an origin change that would reuse the stored password', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const error = await registry
        .update(server.id, { baseUrl: 'https://other-host.example.com' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerCredentialsRequiredError)
      expect((error as { status?: number }).status).toBe(400)
      expect((error as Error).message).toBe(
        'Changing the server address requires re-entering the password or pairing again',
      )
      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('super-secret')
      expect(registry.get(server.id)?.baseUrl).toBe('https://studio.example.com')
    })

    it('allows a path change on the same origin without new credentials', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const updated = await registry.update(server.id, { baseUrl: 'https://studio.example.com/opencode/' })

      expect(updated.baseUrl).toBe('https://studio.example.com/opencode')
      expect(updated.hasPassword).toBe(true)
      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('super-secret')
    })

    it('allows an origin change with a new password', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const updated = await registry.update(server.id, {
        baseUrl: 'https://other-host.example.com',
        password: 'next-secret',
      })

      expect(updated.baseUrl).toBe('https://other-host.example.com')
      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('next-secret')
    })

    it('allows an origin change with an explicit password clear', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const updated = await registry.update(server.id, {
        baseUrl: 'https://other-host.example.com',
        password: null,
      })

      expect(updated.baseUrl).toBe('https://other-host.example.com')
      expect(updated.hasPassword).toBe(false)
      expect(readStoredSecret(db, server.id)).toBeUndefined()
    })

    it('allows an origin change when the server has no stored password', async () => {
      const server = await createServer({ name: 'Open', baseUrl: 'https://studio.example.com' })

      const updated = await registry.update(server.id, { baseUrl: 'https://other-host.example.com' })

      expect(updated.baseUrl).toBe('https://other-host.example.com')
      expect(updated.hasPassword).toBe(false)
    })

    it('allows an origin change with pairing credentials', async () => {
      fetchFn.mockImplementationOnce(async (_url, init) => {
        const { nonce } = JSON.parse(String(init?.body)) as { nonce: string }
        return jsonResponse(await encryptOpenCodePairingCredentials({
          code: PAIR_CODE,
          nonce,
          credentials: { username: 'alice', password: 'paired-pass' },
        }))
      })
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const updated = await registry.update(server.id, {
        baseUrl: 'https://other-host.example.com',
        pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
      })

      expect(updated.baseUrl).toBe('https://other-host.example.com')
      expect(updated.username).toBe('alice')
      expect(decryptSecret(readStoredSecret(db, server.id)!.value)).toBe('paired-pass')
    })
  })

  describe('delete', () => {
    it('removes the server row and its stored password', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      registry.delete(server.id)

      expect(registry.get(server.id)).toBeNull()
      expect(readStoredSecret(db, server.id)).toBeUndefined()
      expect(() => registry.delete(server.id)).toThrow(OpenCodeServerNotFoundError)
    })
  })

  describe('getClient', () => {
    it('returns the local client for the local server id', async () => {
      expect(registry.getClient('local')).toBe(localClient)
    })

    it('caches remote clients and invalidates the cache on update', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      const first = registry.getClient(server.id)
      expect(first).toBeInstanceOf(FetchOpenCodeClient)
      expect(registry.getClient(server.id)).toBe(first)

      await registry.update(server.id, { name: 'Renamed' })

      const second = registry.getClient(server.id)
      expect(second).toBeInstanceOf(FetchOpenCodeClient)
      expect(second).not.toBe(first)
    })

    it('sends stored basic auth without the local default directory header', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })

      await registry.getClient(server.id).forwardRaw(
        new Request('http://localhost:5003/api/opencode/api/info'),
      )

      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('opencode:super-secret')}`)
      expect(headers.get('x-opencode-directory')).toBeNull()
    })

    it('throws a not-found error for unknown and disabled servers', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })
      await registry.update(server.id, { enabled: false })

      expect(() => registry.getClient('srv_missing')).toThrow(OpenCodeServerNotFoundError)
      expect(() => registry.getClient(server.id)).toThrow(OpenCodeServerNotFoundError)
    })
  })

  describe('getConnection', () => {
    it('returns the remote base URL and authorization header', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com/',
        username: 'alice',
        password: 'super-secret',
      })

      expect(registry.getConnection(server.id)).toEqual({
        baseUrl: 'https://studio.example.com',
        authorization: `Basic ${btoa('alice:super-secret')}`,
      })
    })

    it('rejects the local server id', async () => {
      expect(() => registry.getConnection('local')).toThrow(OpenCodeServerError)
    })
  })

  describe('test', () => {
    it('reports a supported version', async () => {
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.1.2' }))

      const result = await registry.test({
        baseUrl: 'https://studio.example.com/',
        username: 'alice',
        password: 'super-secret',
      })

      expect(result).toEqual({ ok: true, version: '2.1.2', versionSupported: true, error: null })
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://studio.example.com/api/info')
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:super-secret')}`)
    })

    it('reports an unsupported version', async () => {
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '1.4.0' }))

      const result = await registry.test({ baseUrl: 'https://studio.example.com', username: 'opencode' })

      expect(result).toEqual({ ok: true, version: '1.4.0', versionSupported: false, error: null })
    })

    it('uses stored credentials for a server id', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        username: 'alice',
        password: 'super-secret',
      })
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.1.2' }))

      const result = await registry.test({ serverId: server.id })

      expect(result.ok).toBe(true)
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:super-secret')}`)
    })

    it('reuses the stored password for a draft on the same origin', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.1.2' }))

      const result = await registry.test({
        baseUrl: 'https://studio.example.com/opencode',
        username: 'alice',
        serverId: server.id,
      })

      expect(result.ok).toBe(true)
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://studio.example.com/opencode/api/info')
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:super-secret')}`)
    })

    it('does not send the stored password to a draft on a different origin', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.1.2' }))

      const result = await registry.test({
        baseUrl: 'https://relocated.example.com',
        username: 'alice',
        serverId: server.id,
      })

      expect(result.ok).toBe(true)
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://relocated.example.com/api/info')
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBeNull()
    })

    it('prefers an explicit draft password over the stored one', async () => {
      const server = await createServer({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        password: 'super-secret',
      })
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.1.2' }))

      await registry.test({
        baseUrl: 'https://studio.example.com',
        username: 'alice',
        password: 'draft-secret',
        serverId: server.id,
      })

      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:draft-secret')}`)
    })

    it('throws a not-found error for an unknown server id on a draft', async () => {
      await expect(
        registry.test({
          baseUrl: 'https://studio.example.com',
          username: 'opencode',
          serverId: 'srv_missing',
        }),
      ).rejects.toBeInstanceOf(OpenCodeServerNotFoundError)
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('reports a failed request without throwing', async () => {
      fetchFn.mockResolvedValueOnce(new Response(null, { status: 500 }))

      const result = await registry.test({ baseUrl: 'https://studio.example.com', username: 'opencode' })

      expect(result.ok).toBe(false)
      expect(result.version).toBeNull()
      expect(result.error).toContain('500')
    })

    it('reports an unreachable server without throwing', async () => {
      fetchFn.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

      const result = await registry.test({ baseUrl: 'https://studio.example.com', username: 'opencode' })

      expect(result).toEqual({
        ok: false,
        version: null,
        versionSupported: false,
        error: 'Could not reach the OpenCode server',
      })
    })

    it('throws a not-found error for an unknown server id', async () => {
      await expect(registry.test({ serverId: 'srv_missing' })).rejects.toBeInstanceOf(OpenCodeServerNotFoundError)
    })
  })

  describe('onChange', () => {
    it('emits upserted and deleted changes and unsubscribes', async () => {
      const changes: OpenCodeServerChange[] = []
      const unsubscribe = registry.onChange((change) => changes.push(change))

      const server = await createServer({ name: 'Studio', baseUrl: 'https://studio.example.com' })
      registry.delete(server.id)
      unsubscribe()
      await createServer({ name: 'Other', baseUrl: 'https://other.example.com' })

      expect(changes).toEqual([
        { type: 'upserted', serverId: server.id },
        { type: 'deleted', serverId: server.id },
      ])
    })
  })
})
