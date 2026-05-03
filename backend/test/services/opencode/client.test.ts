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
    WORKSPACE: { BASE_PATH: '/test/workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config', AUTH_FILE: 'auth.json' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1', SERVER_PASSWORD: '', SERVER_USERNAME: 'opencode' },
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

import { createOpenCodeClient, FetchOpenCodeClient, UpstreamError } from '../../../src/services/opencode/client'
import { ENV } from '@opencode-manager/shared/config/env'

describe('OpenCodeClient', () => {
  const baseUrl = 'http://127.0.0.1:5551'
  const basicAuth = 'Basic dXNlcjpwYXNz'

  describe('forward', () => {
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

      await client.forward({ method: 'GET', path: '/config' })
      await client.forward({ method: 'GET', path: '/config' })

      expect(capturedAuthHeaders).toEqual([
        `Basic ${Buffer.from('opencode:first-password').toString('base64')}`,
        `Basic ${Buffer.from('opencode:second-password').toString('base64')}`,
      ])
    })

    it('should build URL from baseUrl and path, inject auth when present, and strip hop-by-hop headers', async () => {
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

      const result = await client.forward({
        method: 'POST',
        path: '/config',
        body: 'request-body-content',
        headers: { 'X-Caller': 'caller-value' },
      })

      expect(capturedUrl?.toString()).toBe(baseUrl + '/config')
      expect(capturedInit?.method).toBe('POST')
      expect(capturedInit?.body).toBe('request-body-content')
      expect(capturedInit?.headers).toEqual(expect.objectContaining({
        Authorization: basicAuth,
        'X-Caller': 'caller-value',
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

    it('should return 502 JSON Response when fetchFn throws', async () => {
      const fetchFn = async () => {
        throw new Error('Network error')
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.forward({
        method: 'GET',
        path: '/config',
      })

      expect(result.status).toBe(502)
      const body = await result.json()
      expect(body).toEqual({ error: 'Proxy request failed' })
    })

    it('should honour directory by adding URL-encoded query param and preserve existing query string', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      await client.forward({
        method: 'GET',
        path: '/config?foo=bar',
        directory: '/test/dir',
      })

      expect(capturedUrl?.searchParams.get('directory')).toBe('/test/dir')
      expect(capturedUrl?.searchParams.get('foo')).toBe('bar')
    })

    it('should forward an AbortSignal to fetchFn when provided', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedInit: RequestInit | undefined
      const fetchFn = async (_: URL | Request | string, init?: RequestInit) => {
        capturedInit = init
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })
      const controller = new AbortController()

      await client.forward({ method: 'GET', path: '/doc', signal: controller.signal })

      expect(capturedInit?.signal).toBe(controller.signal)
    })

    it('should return 502 Response when fetchFn rejects with AbortError', async () => {
      const fetchFn = async (_input: URL | Request | string, init?: RequestInit) => {
        const signal = init?.signal
        if (signal?.aborted) {
          throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })
      const controller = new AbortController()
      controller.abort()

      const result = await client.forward({ method: 'GET', path: '/doc', signal: controller.signal })

      expect(result.status).toBe(502)
      const body = await result.json()
      expect(body).toEqual({ error: 'Proxy request failed' })
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
        await client.forward({ method: 'GET', path: '/doc' })

        expect(capturedUrl?.origin).toBe('http://127.0.0.1:5551')
      } finally {
        Object.defineProperty(ENV.OPENCODE, 'HOST', { value: '127.0.0.1', configurable: true, writable: true })
        Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true })
      }
    })
  })

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
  })

  describe('getJson', () => {
    it('should return parsed body on 200', async () => {
      const mockData = { config: 'test' }
      const mockResponse = new Response(JSON.stringify(mockData), { status: 200 })
      const fetchFn = async () => mockResponse
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.getJson('/config')
      expect(result).toEqual(mockData)
    })

    it('should throw UpstreamError on 404 with status and bodyText', async () => {
      const mockResponse = new Response('Not found', { status: 404 })
      const fetchFn = async () => {
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      let caughtErr: UpstreamError | undefined
      try {
        await client.getJson('/not-found')
      } catch (err) {
        caughtErr = err as UpstreamError
      }

      expect(caughtErr).toBeDefined()
      expect(caughtErr?.status).toBe(404)
      expect(caughtErr?.bodyText).toBe('Not found')
    })
  })

  describe('postJson', () => {
    it('should post JSON with Content-Type header and merge caller headers', async () => {
      const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 })
      let capturedInit: RequestInit | undefined
      const fetchFn = async (_: URL | Request | string, init?: RequestInit) => {
        capturedInit = init
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      await client.postJson('/test', { data: 'test' }, {
        headers: { 'X-Custom': 'value' },
      })

      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Custom': 'value',
      })
      expect(capturedInit?.body).toBe(JSON.stringify({ data: 'test' }))
    })

    it('should throw UpstreamError on 500', async () => {
      const mockResponse = new Response('Internal error', { status: 500 })
      const fetchFn = async () => mockResponse
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      await expect(client.postJson('/test', {})).rejects.toThrow(UpstreamError)
    })
  })

  describe('setProviderAuth', () => {
    it('should return true on 200', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      const fetchFn = async () => mockResponse
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.setProviderAuth('test-provider', 'api-key')
      expect(result).toBe(true)
    })

    it('should return false on 401', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 401 })
      const fetchFn = async () => mockResponse
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.setProviderAuth('test-provider', 'api-key')
      expect(result).toBe(false)
    })

    it('should return false when fetchFn throws', async () => {
      const fetchFn = async () => {
        throw new Error('Network error')
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.setProviderAuth('test-provider', 'api-key')
      expect(result).toBe(false)
    })
  })

  describe('deleteProviderAuth', () => {
    it('should return true on 200 with DELETE method and no body', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedInit: RequestInit | undefined
      const fetchFn = async (_: URL | Request | string, init?: RequestInit) => {
        capturedInit = init
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.deleteProviderAuth('test-provider')
      expect(result).toBe(true)
      expect(capturedInit?.method).toBe('DELETE')
      expect(capturedInit?.body).toBeUndefined()
    })

    it('should return false on 401', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 401 })
      const fetchFn = async () => mockResponse
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.deleteProviderAuth('test-provider')
      expect(result).toBe(false)
    })

    it('should return false when fetchFn throws', async () => {
      const fetchFn = async () => {
        throw new Error('Network error')
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.deleteProviderAuth('test-provider')
      expect(result).toBe(false)
    })
  })

  describe('startMcpAuth', () => {
    it('should build path with encoded serverName and directory param', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.startMcpAuth('foo bar', '/dir')

      expect(capturedUrl?.pathname).toBe('/mcp/foo%20bar/auth')
      expect(capturedUrl?.searchParams.get('directory')).toBe('/dir')
      expect(result).toBeInstanceOf(Response)
    })
  })

  describe('authenticateMcp', () => {
    it('should build path with auth/authenticate suffix', async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 })
      let capturedUrl: URL | undefined
      const fetchFn = async (input: URL | Request | string) => {
        capturedUrl = input instanceof URL ? input : new URL(input.toString())
        return mockResponse
      }
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn: fetchFn as unknown as typeof fetch })

      const result = await client.authenticateMcp('name', undefined)

      expect(capturedUrl?.pathname).toBe('/mcp/name/auth/authenticate')
      expect(capturedUrl?.searchParams.has('directory')).toBe(false)
      expect(result).toBeInstanceOf(Response)
    })
  })
})
