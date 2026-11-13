import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID, TerminalInfoSchema } from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import type { JsonValue } from '@opencode-manager/shared/utils'
import {
  createOpenCodeServerTerminalRoutes,
  type ServerTerminalServiceResolver,
} from '../../src/routes/opencode-server-terminals'
import { TerminalService } from '../../src/services/terminal'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { OpenCodeServerNotFoundError } from '../../src/services/opencode-server-registry'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createFetchStub, type FetchStub } from '../helpers/fetch-stub'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const DIRECTORY = '/home/me/app'
const SERVER_ID = 'srv_kitchen'
const UNKNOWN_SERVER_ID = 'srv_missing'
const REMOTE_BASE_URL = 'https://remote.internal'
const jsonHeaders = { 'Content-Type': 'application/json' }

type RemotePty = Awaited<ReturnType<OpenCodeApi['pty']['list']>>['data'][number]

const TerminalsResponseSchema = z.object({ terminals: z.array(TerminalInfoSchema) })
const SuccessResponseSchema = z.object({ success: z.boolean() })
const ErrorResponseSchema = z.object({ error: z.string() })
const PtyCreateBodySchema = z.object({
  title: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
})
const PtyUpdateBodySchema = z.object({
  size: z.object({ rows: z.number(), cols: z.number() }).optional(),
})

interface RecordedClientRequest {
  method: string
  pathname: string
  search: string
  body: string
  headers: Headers
}

function createPty(overrides: Partial<RemotePty> = {}): RemotePty {
  return {
    id: 'pty-1',
    title: 'Terminal',
    command: 'sh',
    args: [],
    cwd: DIRECTORY,
    status: 'running',
    pid: 1,
    ...overrides,
  }
}

function jsonResponse(payload: JsonValue): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createRemoteClient(terminals: RemotePty[] = [createPty()]) {
  const fetchFn: FetchStub = createFetchStub(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/pty' && method === 'GET') {
      return jsonResponse({ location: { directory: DIRECTORY }, data: terminals })
    }
    if (url.pathname === '/api/pty' && method === 'POST') {
      const body = PtyCreateBodySchema.parse(JSON.parse(String(init?.body)))
      return jsonResponse({
        location: { directory: DIRECTORY },
        data: createPty({ id: 'pty-new', title: body.title ?? 'Terminal' }),
      })
    }
    if (url.pathname.startsWith('/api/pty/') && method === 'PUT') {
      return jsonResponse({ location: { directory: DIRECTORY }, data: createPty() })
    }
    if (url.pathname.startsWith('/api/pty/') && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  })
  const client = new FetchOpenCodeClient({
    baseUrl: REMOTE_BASE_URL,
    basicAuth: null,
    defaultDirectory: false,
    fetchFn,
  })
  return { client, fetchFn }
}

async function recordedRequests(fetchFn: FetchStub): Promise<RecordedClientRequest[]> {
  return Promise.all(
    fetchFn.mock.calls.map(async ([input, init]) => {
      const url = new URL(String(input))
      return {
        method: init?.method ?? 'GET',
        pathname: url.pathname,
        search: url.search,
        body: await new Response(init?.body ?? null).text(),
        headers: new Headers(init?.headers),
      }
    }),
  )
}

describe('OpenCode Server Terminal Routes', () => {
  let db: Database
  let credentialProvider: CredentialProvider

  beforeEach(() => {
    db = createTestDatabase()
    credentialProvider = new CredentialProvider(db)
  })

  function createService(includeLocalEnv = false, terminals?: RemotePty[]) {
    const remote = createRemoteClient(terminals)
    const service = new TerminalService(
      { client: remote.client, baseUrl: () => REMOTE_BASE_URL, includeLocalEnv },
      credentialProvider,
      createStubRepoEnvService(),
    )
    return { service, ...remote }
  }

  function createApp(service: TerminalService): Hono {
    const resolveService: ServerTerminalServiceResolver = (serverId) => {
      if (serverId === UNKNOWN_SERVER_ID) throw new OpenCodeServerNotFoundError(serverId)
      return service
    }
    const app = new Hono()
    app.route('/', createOpenCodeServerTerminalRoutes(resolveService))
    return app
  }

  describe('GET /:serverId/terminals', () => {
    it('lists the terminals of the remote directory', async () => {
      const { service, fetchFn } = createService()

      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(200)
      await expect(readJson(res, TerminalsResponseSchema)).resolves.toEqual({
        terminals: [{ id: 'pty-1', title: 'Terminal', kind: 'shell', cwd: DIRECTORY, status: 'running' }],
      })
      const [request] = await recordedRequests(fetchFn)
      expect(request?.method).toBe('GET')
      expect(request?.pathname).toBe('/api/pty')
      expect(new URLSearchParams(request?.search).get('location[directory]')).toBe(DIRECTORY)
    })

    it('rejects the local server', async () => {
      const { service } = createService()

      const res = await createApp(service).request(
        `/${LOCAL_OPENCODE_SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown server', async () => {
      const { service } = createService()

      const res = await createApp(service).request(
        `/${UNKNOWN_SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
        error: `OpenCode server not found: ${UNKNOWN_SERVER_ID}`,
      })
    })

    it.each(['', '?directory=relative/path'])('requires an absolute directory (%s)', async (query) => {
      const { service } = createService()

      const res = await createApp(service).request(`/${SERVER_ID}/terminals${query}`)

      expect(res.status).toBe(400)
    })
  })

  describe('POST /:serverId/terminals', () => {
    it('creates a shell without local credentials', async () => {
      const { service, fetchFn } = createService()
      const getGhCliEnv = vi.spyOn(credentialProvider, 'getGhCliEnv')

      const res = await createApp(service).request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, title: 'Remote shell' }),
      })

      expect(res.status).toBe(200)
      expect(getGhCliEnv).not.toHaveBeenCalled()
      const [request] = await recordedRequests(fetchFn)
      expect(request?.method).toBe('POST')
      expect(request?.pathname).toBe('/api/pty')
      await expect(readJson(res, TerminalInfoSchema)).resolves.toEqual({
        id: 'pty-new',
        title: 'Remote shell',
        kind: 'shell',
        cwd: DIRECTORY,
        status: 'running',
      })
    })

    it('forwards an empty environment and defaults the title', async () => {
      const { service, fetchFn } = createService()

      const res = await createApp(service).request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY }),
      })

      expect(res.status).toBe(200)
      const [request] = await recordedRequests(fetchFn)
      expect(PtyCreateBodySchema.parse(JSON.parse(request?.body ?? ''))).toEqual({ title: 'Terminal', env: {} })
    })

    it('rejects a missing directory', async () => {
      const { service, fetchFn } = createService()

      const res = await createApp(service).request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /:serverId/terminals/:ptyID', () => {
    it('resizes a terminal of the remote server', async () => {
      const { service, fetchFn } = createService()

      const res = await createApp(service).request(`/${SERVER_ID}/terminals/pty-1`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, cols: 120, rows: 40 }),
      })

      expect(res.status).toBe(200)
      await expect(readJson(res, SuccessResponseSchema)).resolves.toEqual({ success: true })
      const request = (await recordedRequests(fetchFn)).find((entry) => entry.method === 'PUT')
      expect(request?.pathname).toBe('/api/pty/pty-1')
      expect(PtyUpdateBodySchema.parse(JSON.parse(request?.body ?? ''))).toEqual({
        size: { rows: 40, cols: 120 },
      })
    })

    it('returns 404 for an unknown PTY id', async () => {
      const { service, fetchFn } = createService(false, [])

      const res = await createApp(service).request(`/${SERVER_ID}/terminals/missing`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(404)
      expect((await recordedRequests(fetchFn)).some((entry) => entry.method === 'PUT')).toBe(false)
    })
  })

  describe('DELETE /:serverId/terminals/:ptyID', () => {
    it('removes a terminal of the remote server', async () => {
      const { service, fetchFn } = createService()

      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals/pty-1?directory=${encodeURIComponent(DIRECTORY)}`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(200)
      await expect(readJson(res, SuccessResponseSchema)).resolves.toEqual({ success: true })
      const request = (await recordedRequests(fetchFn)).find((entry) => entry.method === 'DELETE')
      expect(request?.pathname).toBe('/api/pty/pty-1')
    })

    it('returns 404 for an unknown PTY id', async () => {
      const { service, fetchFn } = createService(false, [])

      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals/missing?directory=${encodeURIComponent(DIRECTORY)}`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(404)
      expect((await recordedRequests(fetchFn)).some((entry) => entry.method === 'DELETE')).toBe(false)
    })
  })
})
