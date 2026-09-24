import { describe, it, expect, vi } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/test/workspace'),
  getOpenCodeConfigFilePath: vi.fn(() => '/test/workspace/.config/opencode.json'),
  getReposPath: vi.fn(() => '/test/workspace/repos'),
  getAgentsMdPath: vi.fn(() => '/test/workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/test/workspace/config'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/test/workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1', SERVER_PASSWORD: '' },
    DATABASE: { PATH: ':memory:' },
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createOpenCodeClient, FetchOpenCodeClient } from '../../../src/services/opencode/client'
import { ENV } from '@opencode-manager/shared/config/env'

describe('OpenCodeClient', () => {
  const baseUrl = 'http://127.0.0.1:5551'
  const basicAuth = 'Basic dXNlcjpwYXNz'

  describe('forwardRaw', () => {
    it('should strip /api/opencode prefix from path, preserve search string, and strip host/connection/authorization headers', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedUrl: URL | undefined
      let capturedInit: RequestInit | undefined
      const fetchFn = async (input: URL | Request | string, init?: RequestInit) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        capturedInit = init
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const request = new Request('http://localhost:5003/api/opencode/config?query=1', {
        method: 'GET',
        headers: {
          'Host': 'localhost:5003',
          'Connection': 'keep-alive',
          'Authorization': 'Bearer token',
          'X-Custom-Header': 'value',
        },
      })

      await client.forwardRaw(request)

      expect(capturedUrl?.pathname).toBe('/config')
      expect(capturedUrl?.searchParams.get('query')).toBe('1')

      expect(capturedInit?.headers).toEqual(expect.objectContaining({
        'x-custom-header': 'value',
      }))
      expect((capturedInit?.headers as Record<string, string>)['host']).toBeUndefined()
      expect((capturedInit?.headers as Record<string, string>)['connection']).toBeUndefined()
      expect((capturedInit?.headers as Record<string, string>)['authorization']).toBeUndefined()
    })

    it('should read body for POST but not for GET/HEAD', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      const capturedBodies: unknown[] = []
      const fetchFn = async (_: URL | Request | string, init?: RequestInit) => {
        capturedBodies.push(init?.body)
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const postRequest = new Request('http://localhost:5003/api/opencode/test', {
        method: 'POST',
        body: 'test body',
      })

      await client.forwardRaw(postRequest)

      const getRequest = new Request('http://localhost:5003/api/opencode/test', {
        method: 'GET',
      })

      await client.forwardRaw(getRequest)

      const headRequest = new Request('http://localhost:5003/api/opencode/test', {
        method: 'HEAD',
      })

      await client.forwardRaw(headRequest)

      expect(capturedBodies[0]).toBe('test body')
      expect(capturedBodies[1]).toBeUndefined()
      expect(capturedBodies[2]).toBeUndefined()
    })

    it('should resolve basic auth dynamically for each request', async () => {
      const capturedAuthHeaders: Array<string | undefined> = []
      const passwords = ['first-password', 'second-password']
      const fetchFn = async (_: URL | Request | string, init?: RequestInit) => {
        capturedAuthHeaders.push((init?.headers as Record<string, string>).Authorization)
        return new Response(JSON.stringify({}), { status: 200 })
      }
      const client = new FetchOpenCodeClient({
        baseUrl,
        basicAuth: null,
        passwordResolver: () => passwords.shift() ?? '',
        fetchFn: fetchFn as unknown as typeof fetch,
      })

      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))

      expect(capturedAuthHeaders).toEqual([
        `Basic ${Buffer.from('opencode:first-password').toString('base64')}`,
        `Basic ${Buffer.from('opencode:second-password').toString('base64')}`,
      ])
    })

    it('should inject auth when present and strip hop-by-hop response headers', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '100',
          'Content-Encoding': 'gzip',
          'Transfer-Encoding': 'chunked',
          'Connection': 'keep-alive',
        },
      })

      let capturedUrl: URL | undefined
      let capturedInit: RequestInit | undefined
      const fetchFn = async (input: URL | Request | string, init?: RequestInit) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        capturedInit = init
        return mockResponse
      }

      const client = new FetchOpenCodeClient({ baseUrl, basicAuth, fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config?foo=bar', {
        method: 'POST',
        body: 'request-body-content',
        headers: { 'X-Caller': 'caller-value' },
      }))

      expect(capturedUrl?.toString()).toBe(baseUrl + '/config?foo=bar')
      expect(capturedInit?.method).toBe('POST')
      expect(capturedInit?.body).toBe('request-body-content')
      expect(capturedInit?.headers).toEqual(expect.objectContaining({
        Authorization: basicAuth,
        'x-caller': 'caller-value',
      }))

      const resultHeaders: Record<string, string> = {}
      result.headers.forEach((value, key) => {
        resultHeaders[key] = value
      })

      expect(resultHeaders['content-length']).toBeUndefined()
      expect(resultHeaders['content-encoding']).toBeUndefined()
      expect(resultHeaders['transfer-encoding']).toBeUndefined()
      expect(resultHeaders['connection']).toBeUndefined()
      expect(resultHeaders['content-type']).toBe('application/json')
    })

    it('should return a 502 JSON Response when fetchFn throws', async () => {
      const fetchFn = async () => {
        throw new Error('Network error')
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))

      expect(result.status).toBe(502)
      const body = await result.json()
      expect(body).toEqual({ error: 'Proxy request failed' })
    })
  })

  describe('api', () => {
    const serverInfo = { version: '2.0.15', pid: 1234, urls: ['http://127.0.0.1:5551'], paths: { tmp: '/tmp' } }

    it('probes GET /api/info with the resolver password on every call', async () => {
      const capturedUrls: string[] = []
      const capturedAuthHeaders: Array<string | undefined> = []
      const passwords = ['first-password', 'second-password']
      const fetchFn = async (input: URL | Request | string, init?: RequestInit) => {
        capturedUrls.push(input instanceof URL ? input.toString() : input.toString())
        capturedAuthHeaders.push(new Headers(init?.headers).get('authorization') ?? undefined)
        return new Response(JSON.stringify(serverInfo), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const client = new FetchOpenCodeClient({
        baseUrl,
        basicAuth: null,
        passwordResolver: () => passwords.shift() ?? '',
        fetchFn: fetchFn as unknown as typeof fetch,
      })

      await client.api.server.info()
      await client.api.server.info()

      expect(capturedUrls).toEqual([`${baseUrl}/api/info`, `${baseUrl}/api/info`])
      expect(capturedAuthHeaders).toEqual([
        `Basic ${Buffer.from('opencode:first-password').toString('base64')}`,
        `Basic ${Buffer.from('opencode:second-password').toString('base64')}`,
      ])
    })

    it('fails the info probe when the upstream answers 401', async () => {
      const fetchFn = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      await expect(client.api.server.info()).rejects.toThrow()
    })

    it('fails the info probe when the upstream answers HTML', async () => {
      const fetchFn = async () => new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      await expect(client.api.server.info()).rejects.toThrow()
    })
  })

  describe('createOpenCodeClient', () => {
    it('uses loopback connect host when OPENCODE_HOST binds externally', async () => {
      const originalFetch = globalThis.fetch
      Object.defineProperty(ENV.OPENCODE, 'HOST', { value: '0.0.0.0', configurable: true, writable: true })
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return new Response(JSON.stringify({}), { status: 200 })
      }
      Object.defineProperty(globalThis, 'fetch', { value: fetchFn, configurable: true, writable: true })

      try {
        const client = createOpenCodeClient('testpassword')
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

        expect(capturedUrl?.origin).toBe('http://127.0.0.1:5551')
      } finally {
        Object.defineProperty(ENV.OPENCODE, 'HOST', { value: '127.0.0.1', configurable: true, writable: true })
        Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true })
      }
    })

    it('honours an explicit host override instead of OPENCODE_HOST', async () => {
      const originalFetch = globalThis.fetch
      const originalHost = ENV.OPENCODE.HOST
      Object.defineProperty(ENV.OPENCODE, 'HOST', { value: '192.168.1.10', configurable: true, writable: true })
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return new Response(JSON.stringify({}), { status: 200 })
      }
      Object.defineProperty(globalThis, 'fetch', { value: fetchFn, configurable: true, writable: true })

      try {
        const client = createOpenCodeClient('testpassword', '127.0.0.1')
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

        expect(capturedUrl?.origin).toBe('http://127.0.0.1:5551')
      } finally {
        Object.defineProperty(ENV.OPENCODE, 'HOST', { value: originalHost, configurable: true, writable: true })
        Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true })
      }
    })

    it('brackets an IPv6 loopback host in the request URL', async () => {
      const originalFetch = globalThis.fetch
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return new Response(JSON.stringify({}), { status: 200 })
      }
      Object.defineProperty(globalThis, 'fetch', { value: fetchFn, configurable: true, writable: true })

      try {
        const client = createOpenCodeClient('testpassword', '::1')
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

        expect(capturedUrl?.origin).toBe('http://[::1]:5551')
      } finally {
        Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true })
      }
    })

    it('resolves a lazy host override on every request', async () => {
      const originalFetch = globalThis.fetch
      const hosts: string[] = []
      let currentHost = '192.168.1.10'
      const fetchFn = async (input: URL | Request | string) => {
        hosts.push(input instanceof URL ? input.hostname : new URL(input.toString()).hostname)
        return new Response(JSON.stringify({}), { status: 200 })
      }
      Object.defineProperty(globalThis, 'fetch', { value: fetchFn, configurable: true, writable: true })

      try {
        const client = createOpenCodeClient('testpassword', () => currentHost)
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))
        currentHost = '127.0.0.1'
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

        expect(hosts).toEqual(['192.168.1.10', '127.0.0.1'])
      } finally {
        Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true })
      }
    })
  })
})
