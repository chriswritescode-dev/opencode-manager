import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { decryptSecret } from '../utils/crypto'
import {
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

describe('OpenCodeServerRegistry', () => {
  let db: Database
  let localClient: OpenCodeClient
  let fetchFn: FetchMock
  let registry: OpenCodeServerRegistry

  beforeEach(() => {
    db = createTestDb()
    localClient = createLocalClient()
    fetchFn = vi.fn(async () => jsonResponse({}))
    registry = new OpenCodeServerRegistry(db, localClient, fetchFn as unknown as typeof fetch)
  })

  describe('create', () => {
    it('creates a server with a normalized base URL and an encrypted password', async () => {
      const server = await registry.create({
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
      const server = await registry.create({ name: 'Open', baseUrl: 'http://localhost:4096' })

      expect(server.hasPassword).toBe(false)
      expect(readStoredSecret(db, server.id)).toBeUndefined()
    })

    it('rejects an invalid request with a validation error', async () => {
      await expect(registry.create({ name: '', baseUrl: 'not-a-url' })).rejects.toMatchObject({ status: 400 })
    })

    it('redeems a pairing code and stores the returned credentials', async () => {
      fetchFn.mockResolvedValueOnce(jsonResponse({ username: 'alice', password: 'paired-pass' }))

      const server = await registry.create({
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
      expect(init?.body).toBe(JSON.stringify({ code: PAIR_CODE }))
    })

    it('fails with a pairing error when the pairing endpoint rejects the code', async () => {
      fetchFn.mockResolvedValueOnce(new Response(null, { status: 403 }))

      await expect(
        registry.create({
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

      const error = await registry
        .create({
          name: 'Paired',
          baseUrl: 'https://remote.example.com',
          pairing: { pairUrl: PAIR_URL, code: PAIR_CODE },
        })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeServerPairingError)
      expect((error as Error).message).not.toContain(PAIR_CODE)
    })
  })

  describe('update', () => {
    it('updates fields and clears the password when null is sent', async () => {
      const server = await registry.create({
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
      const server = await registry.create({
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
  })

  describe('delete', () => {
    it('removes the server row and its stored password', async () => {
      const server = await registry.create({
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
      const server = await registry.create({
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
      const server = await registry.create({
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
      const server = await registry.create({
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
      const server = await registry.create({
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
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.0.15' }))

      const result = await registry.test({
        baseUrl: 'https://studio.example.com/',
        username: 'alice',
        password: 'super-secret',
      })

      expect(result).toEqual({ ok: true, version: '2.0.15', versionSupported: true, error: null })
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://studio.example.com/api/info')
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:super-secret')}`)
    })

    it('reports an unsupported version', async () => {
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '1.4.0' }))

      const result = await registry.test({ baseUrl: 'https://studio.example.com' })

      expect(result).toEqual({ ok: true, version: '1.4.0', versionSupported: false, error: null })
    })

    it('uses stored credentials for a server id', async () => {
      const server = await registry.create({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        username: 'alice',
        password: 'super-secret',
      })
      fetchFn.mockResolvedValueOnce(jsonResponse({ version: '2.0.15' }))

      const result = await registry.test({ serverId: server.id })

      expect(result.ok).toBe(true)
      const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
      expect(headers.get('authorization')).toBe(`Basic ${btoa('alice:super-secret')}`)
    })

    it('reports a failed request without throwing', async () => {
      fetchFn.mockResolvedValueOnce(new Response(null, { status: 500 }))

      const result = await registry.test({ baseUrl: 'https://studio.example.com' })

      expect(result.ok).toBe(false)
      expect(result.version).toBeNull()
      expect(result.error).toContain('500')
    })

    it('reports an unreachable server without throwing', async () => {
      fetchFn.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

      const result = await registry.test({ baseUrl: 'https://studio.example.com' })

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

      const server = await registry.create({ name: 'Studio', baseUrl: 'https://studio.example.com' })
      registry.delete(server.id)
      unsubscribe()
      await registry.create({ name: 'Other', baseUrl: 'https://other.example.com' })

      expect(changes).toEqual([
        { type: 'upserted', serverId: server.id },
        { type: 'deleted', serverId: server.id },
      ])
    })
  })
})
