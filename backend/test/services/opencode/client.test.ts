import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ENV, getWorkspacePath } from '@opencode-manager/shared/config/env'
import { openCodeLocation } from '@opencode-manager/shared/opencode'
import { createOpenCodeClient, FetchOpenCodeClient } from '../../../src/services/opencode/client'
import { createFetchStub } from '../../helpers/fetch-stub'
import { readJson } from '../../helpers/read-json'
import { createTempWorkspace, type TempWorkspace } from '../../helpers/test-env'

const ErrorResponseSchema = z.object({ error: z.string() })

async function readBodyText(body: RequestInit['body']): Promise<string | null> {
  if (!(body instanceof ReadableStream)) return null
  return await new Response(body).text()
}

function captureUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

function stubEnvHost(host: string): () => void {
  const previous = ENV.OPENCODE.HOST
  Object.defineProperty(ENV.OPENCODE, 'HOST', { value: host, configurable: true, writable: true })
  return () => {
    Object.defineProperty(ENV.OPENCODE, 'HOST', { value: previous, configurable: true, writable: true })
  }
}

describe('OpenCodeClient', () => {
  const baseUrl = 'http://127.0.0.1:5551'
  const basicAuth = 'Basic dXNlcjpwYXNz'
  let workspace: TempWorkspace
  let previousLogLevel: string | undefined

  beforeAll(() => {
    workspace = createTempWorkspace('ocm-opencode-client-')
    previousLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'error'
  })

  afterAll(() => {
    workspace.restore()
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = previousLogLevel
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('forwardRaw', () => {
    it('strips the /api/opencode prefix, keeps the search string, and drops host/connection/authorization/cookie headers', async () => {
      let capturedUrl: URL | undefined
      let capturedInit: RequestInit | undefined
      const fetchFn = createFetchStub(async (input, init) => {
        capturedUrl = captureUrl(input)
        capturedInit = init
        return new Response(JSON.stringify({}), { status: 200 })
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      const request = new Request('http://localhost:5003/api/opencode/config?query=1', {
        method: 'GET',
        headers: {
          'Host': 'localhost:5003',
          'Connection': 'keep-alive',
          'Authorization': 'Bearer token',
          'Cookie': 'session=manager',
          'X-Custom-Header': 'value',
        },
      })

      await client.forwardRaw(request)

      expect(capturedUrl?.pathname).toBe('/config')
      expect(capturedUrl?.searchParams.get('query')).toBe('1')

      const forwardedHeaders = new Headers(capturedInit?.headers)
      expect(forwardedHeaders.get('x-custom-header')).toBe('value')
      expect(forwardedHeaders.get('host')).toBeNull()
      expect(forwardedHeaders.get('connection')).toBeNull()
      expect(forwardedHeaders.get('authorization')).toBeNull()
      expect(forwardedHeaders.get('cookie')).toBeNull()
      expect(forwardedHeaders.get('x-opencode-directory')).toBe(encodeURIComponent(workspace.path))
    })

    it('keeps a caller-supplied x-opencode-directory header', async () => {
      let capturedInit: RequestInit | undefined
      const fetchFn = createFetchStub(async (_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify({}), { status: 200 })
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/api/config', {
        headers: { 'X-OpenCode-Directory': '%2Frepo%2Fb' },
      }))

      expect(new Headers(capturedInit?.headers).get('x-opencode-directory')).toBe('%2Frepo%2Fb')
    })

    it('streams the body for POST but not for GET/HEAD', async () => {
      const capturedBodies: Array<RequestInit['body']> = []
      const fetchFn = createFetchStub(async (_input, init) => {
        capturedBodies.push(init?.body)
        return new Response(JSON.stringify({}), { status: 200 })
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

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

      expect(capturedBodies[0]).toBeInstanceOf(ReadableStream)
      expect(await readBodyText(capturedBodies[0])).toBe('test body')
      expect(capturedBodies[1]).toBeUndefined()
      expect(capturedBodies[2]).toBeUndefined()
    })

    it('resolves basic auth dynamically for each request', async () => {
      const capturedAuthHeaders: Array<string | null> = []
      const passwords = ['first-password', 'second-password']
      const fetchFn = createFetchStub(async (_input, init) => {
        capturedAuthHeaders.push(new Headers(init?.headers).get('authorization'))
        return new Response(JSON.stringify({}), { status: 200 })
      })
      const client = new FetchOpenCodeClient({
        baseUrl,
        basicAuth: null,
        passwordResolver: () => passwords.shift() ?? '',
        fetchFn,
      })

      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))

      expect(capturedAuthHeaders).toEqual([
        `Basic ${Buffer.from('opencode:first-password').toString('base64')}`,
        `Basic ${Buffer.from('opencode:second-password').toString('base64')}`,
      ])
    })

    it('injects auth when present and strips hop-by-hop response headers', async () => {
      const response = new Response(JSON.stringify({ data: 'test' }), {
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
      const fetchFn = createFetchStub(async (input, init) => {
        capturedUrl = captureUrl(input)
        capturedInit = init
        return response
      })

      const client = new FetchOpenCodeClient({ baseUrl, basicAuth, fetchFn })

      const result = await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config?foo=bar', {
        method: 'POST',
        body: 'request-body-content',
        headers: { 'X-Caller': 'caller-value' },
      }))

      expect(capturedUrl?.toString()).toBe(baseUrl + '/config?foo=bar')
      expect(capturedInit?.method).toBe('POST')
      expect(capturedInit?.body).toBeInstanceOf(ReadableStream)
      expect(await readBodyText(capturedInit?.body)).toBe('request-body-content')
      expect(capturedInit?.duplex).toBe('half')

      const forwardedHeaders = new Headers(capturedInit?.headers)
      expect(forwardedHeaders.get('authorization')).toBe(basicAuth)
      expect(forwardedHeaders.get('x-caller')).toBe('caller-value')

      const resultHeaders = new Headers(result.headers)
      expect(resultHeaders.get('content-length')).toBeNull()
      expect(resultHeaders.get('content-encoding')).toBeNull()
      expect(resultHeaders.get('transfer-encoding')).toBeNull()
      expect(resultHeaders.get('connection')).toBeNull()
      expect(resultHeaders.get('content-type')).toBe('application/json')
    })

    it('returns a 502 JSON Response when the transport throws', async () => {
      const fetchFn = createFetchStub(async () => {
        throw new Error('Network error')
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      const result = await client.forwardRaw(new Request('http://localhost:5003/api/opencode/config'))

      expect(result.status).toBe(502)
      expect(await readJson(result, ErrorResponseSchema)).toEqual({ error: 'Proxy request failed' })
    })
  })

  describe('api', () => {
    const serverInfo = { version: '2.0.15', pid: 1234, urls: ['http://127.0.0.1:5551'], paths: { tmp: '/tmp' } }

    it('probes GET /api/info with the resolver password on every call', async () => {
      const capturedUrls: string[] = []
      const capturedAuthHeaders: Array<string | null> = []
      const passwords = ['first-password', 'second-password']
      const fetchFn = createFetchStub(async (input, init) => {
        capturedUrls.push(captureUrl(input).toString())
        capturedAuthHeaders.push(new Headers(init?.headers).get('authorization'))
        return new Response(JSON.stringify(serverInfo), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })
      const client = new FetchOpenCodeClient({
        baseUrl,
        basicAuth: null,
        passwordResolver: () => passwords.shift() ?? '',
        fetchFn,
      })

      await client.api.server.info()
      await client.api.server.info()

      expect(capturedUrls).toEqual([`${baseUrl}/api/info`, `${baseUrl}/api/info`])
      expect(capturedAuthHeaders).toEqual([
        `Basic ${Buffer.from('opencode:first-password').toString('base64')}`,
        `Basic ${Buffer.from('opencode:second-password').toString('base64')}`,
      ])
    })

    it('scopes location-less requests to the workspace and leaves explicit locations to the query', async () => {
      const captured: Array<{ url: string; directory: string | null }> = []
      const fetchFn = createFetchStub(async (input, init) => {
        captured.push({ url: captureUrl(input).toString(), directory: new Headers(init?.headers).get('x-opencode-directory') })
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      await client.api.integration.list().catch(() => undefined)
      await client.api.skill.list(openCodeLocation('/repo/a')).catch(() => undefined)

      expect(captured[0]).toEqual({ url: `${baseUrl}/api/integration`, directory: encodeURIComponent(getWorkspacePath()) })
      expect(captured[1]?.url).toBe(`${baseUrl}/api/skill?location%5Bdirectory%5D=%2Frepo%2Fa`)
    })

    it('fails the info probe when the upstream answers 401', async () => {
      const fetchFn = createFetchStub(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      await expect(client.api.server.info()).rejects.toThrow()
    })

    it('fails the info probe when the upstream answers HTML', async () => {
      const fetchFn = createFetchStub(async () => new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      const client = new FetchOpenCodeClient({ baseUrl, basicAuth: '', fetchFn })

      await expect(client.api.server.info()).rejects.toThrow()
    })
  })

  describe('createOpenCodeClient', () => {
    function captureForwardOrigin() {
      let capturedUrl: URL | undefined
      vi.stubGlobal('fetch', createFetchStub(async (input) => {
        capturedUrl = captureUrl(input)
        return new Response(JSON.stringify({}), { status: 200 })
      }))
      return { origin: () => capturedUrl?.origin }
    }

    it('uses the loopback connect host when OPENCODE_HOST binds externally', async () => {
      const captured = captureForwardOrigin()

      const client = createOpenCodeClient('testpassword', '0.0.0.0')
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

      expect(captured.origin()).toBe('http://127.0.0.1:5551')
    })

    it('honours an explicit host override instead of OPENCODE_HOST', async () => {
      const restoreHost = stubEnvHost('192.168.1.10')
      const captured = captureForwardOrigin()

      try {
        const client = createOpenCodeClient('testpassword', '127.0.0.1')
        await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

        expect(captured.origin()).toBe('http://127.0.0.1:5551')
      } finally {
        restoreHost()
      }
    })

    it('brackets an IPv6 loopback host in the request URL', async () => {
      const captured = captureForwardOrigin()

      const client = createOpenCodeClient('testpassword', '::1')
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

      expect(captured.origin()).toBe('http://[::1]:5551')
    })

    it('resolves a lazy host override on every request', async () => {
      const hosts: string[] = []
      let currentHost = '192.168.1.10'
      vi.stubGlobal('fetch', createFetchStub(async (input) => {
        hosts.push(captureUrl(input).hostname)
        return new Response(JSON.stringify({}), { status: 200 })
      }))

      const client = createOpenCodeClient('testpassword', () => currentHost)
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))
      currentHost = '127.0.0.1'
      await client.forwardRaw(new Request('http://localhost:5003/api/opencode/doc'))

      expect(hosts).toEqual(['192.168.1.10', '127.0.0.1'])
    })
  })
})
