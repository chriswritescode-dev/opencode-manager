import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Session } from '../../src/auth'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { createSSEAggregator, type SSEAggregator } from '../../src/services/sse-aggregator'
import { closeSessionConnections } from '../../src/services/session-connections'
import { createSSERoutes } from '../../src/routes/sse'
import { readJson } from '../helpers/read-json'

const decoder = new TextDecoder()

const ConnectedFrameSchema = z.object({
  clientId: z.string(),
  directories: z.array(z.string()),
  connected: z.number(),
  total: z.number(),
})
const SuccessResponseSchema = z.object({ success: z.boolean() })
const ErrorResponseSchema = z.object({ success: z.boolean(), error: z.string() })
const StatusResponseSchema = z.object({
  connected: z.number(),
  total: z.number(),
  clients: z.number(),
  directories: z.array(z.string()),
  activeSessions: z.record(z.string(), z.array(z.string())),
})

const serverConnectedEvent = {
  id: 'evt_connected',
  type: 'server.connected',
  data: {},
} satisfies V2Event

function createSession(sessionId: string): Session {
  return {
    session: {
      id: sessionId,
      userId: 'user-1',
      token: `token-${sessionId}`,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'user',
    },
  }
}

function responseReader(response: Response) {
  if (!response.body) throw new Error('expected a streaming response body')
  return response.body.getReader()
}

async function readFrame(reader: ReturnType<typeof responseReader>): Promise<string> {
  const { value, done } = await reader.read()
  if (done || value === undefined) throw new Error('expected an SSE frame')
  return decoder.decode(value)
}

function parseConnectedFrame(frame: string) {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
  if (dataLine === undefined) throw new Error('expected a data line in the connected frame')
  return ConnectedFrameSchema.parse(JSON.parse(dataLine.slice(6)))
}

describe('SSE routes', () => {
  let aggregator: SSEAggregator
  let app: ReturnType<typeof createSSERoutes>

  beforeEach(() => {
    aggregator = createSSEAggregator()
    app = createSSERoutes(aggregator)
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.restoreAllMocks()
  })

  function createSessionScopedApp(sessionId: string) {
    const sessionApp = new Hono<{ Variables: { session: Session['session'] } }>()
    sessionApp.use('/*', async (c, next) => {
      c.set('session', createSession(sessionId).session)
      await next()
    })
    sessionApp.route('/', createSSERoutes(aggregator))
    return sessionApp
  }

  describe('GET /stream', () => {
    it('streams the connected frame and registers the client with its directories', async () => {
      const res = await app.fetch(new Request('http://localhost/stream?directories=/one,/two,,/three'))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache, no-store, no-transform')
      expect(res.headers.get('connection')).toBe('keep-alive')
      expect(res.headers.get('x-accel-buffering')).toBe('no')

      const reader = responseReader(res)
      try {
        const connected = parseConnectedFrame(await readFrame(reader))
        expect(connected.clientId).toMatch(/^client_\d+_[a-z0-9]+$/)
        expect(connected.directories).toEqual(['/one', '/two', '/three'])
        expect(connected.connected).toBe(0)
        expect(connected.total).toBe(0)
        expect(aggregator.getClientCount()).toBe(1)
        expect(aggregator.hasClientDirectory(connected.clientId, '/two')).toBe(true)

        aggregator.broadcastToAll('message', '{"from":"callback"}')
        await expect(readFrame(reader)).resolves.toBe('event: message\ndata: {"from":"callback"}\n\n')

        aggregator.deliverRemoteEnvelope('srv_a', '/one', serverConnectedEvent)
        const frame = await readFrame(reader)
        expect(frame).toContain('event: message')
        expect(frame).toContain('"serverId":"srv_a"')
      } finally {
        await reader.cancel()
      }

      await vi.waitFor(() => expect(aggregator.getClientCount()).toBe(0))
    })

    it('registers no directories when the query is absent', async () => {
      const res = await app.fetch(new Request('http://localhost/stream'))

      const reader = responseReader(res)
      try {
        await expect(readFrame(reader)).resolves.toContain('"directories":[]')
      } finally {
        await reader.cancel()
      }

      await vi.waitFor(() => expect(aggregator.getClientCount()).toBe(0))
    })

    it('registers remote server directory keys unchanged', async () => {
      const directories = ['/local', 'srv_a|/remote', 'srv_b|/other']
      const res = await app.fetch(new Request(`http://localhost/stream?directories=${encodeURIComponent(directories.join(','))}`))

      const reader = responseReader(res)
      try {
        const connected = parseConnectedFrame(await readFrame(reader))
        expect(connected.directories).toEqual(directories)
        expect(aggregator.hasClientDirectory(connected.clientId, 'srv_a|/remote')).toBe(true)
      } finally {
        await reader.cancel()
      }
    })
  })

  describe('POST /subscribe', () => {
    it('subscribes directories for an existing client', async () => {
      aggregator.addClient('client-1', () => {}, () => {}, [])

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', directories: ['/a', '/b'] }),
      }))

      expect(res.status).toBe(200)
      await expect(readJson(res, SuccessResponseSchema)).resolves.toEqual({ success: true })
      expect(aggregator.hasClientDirectory('client-1', '/a')).toBe(true)
      expect(aggregator.hasClientDirectory('client-1', '/b')).toBe(true)
    })

    it('returns 404 when the client is not registered', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', directories: ['/a'] }),
      }))

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('POST /unsubscribe', () => {
    it('removes directories from an existing client', async () => {
      aggregator.addClient('client-1', () => {}, () => {}, ['/a', '/b'])

      const res = await app.fetch(new Request('http://localhost/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', directories: ['/a'] }),
      }))

      expect(res.status).toBe(200)
      await expect(readJson(res, SuccessResponseSchema)).resolves.toEqual({ success: true })
      expect(aggregator.hasClientDirectory('client-1', '/a')).toBe(false)
      expect(aggregator.hasClientDirectory('client-1', '/b')).toBe(true)
    })

    it('returns 404 when the client is not registered', async () => {
      const res = await app.fetch(new Request('http://localhost/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', directories: ['/a'] }),
      }))

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('POST /visibility', () => {
    it.each([
      ['an explicit active session', { visible: true, activeSessionId: 'session-9' }, { local: true, remote: false }],
      ['a hidden client', { visible: false, activeSessionId: 'session-9' }, { local: false, remote: false }],
      ['an explicit active server', { visible: true, activeSessionId: 'session-9', activeServerId: 'srv_a' }, { local: false, remote: true }],
    ] as const)('records %s', async (_label, overrides, expected) => {
      aggregator.addClient('client-1', () => {}, () => {}, [])

      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', ...overrides }),
      }))

      expect(res.status).toBe(200)
      await expect(readJson(res, SuccessResponseSchema)).resolves.toEqual({ success: true })
      expect(aggregator.isSessionBeingViewed('session-9')).toBe(expected.local)
      expect(aggregator.isSessionBeingViewed('session-9', 'srv_a')).toBe(expected.remote)
    })

    it('returns 404 when the client is not registered', async () => {
      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', visible: true }),
      }))

      expect(res.status).toBe(404)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('invalid request bodies', () => {
    it.each([
      ['/subscribe', { clientId: '', directories: 'not-an-array' }],
      ['/unsubscribe', { directories: [] }],
      ['/visibility', { clientId: 'client-1', visible: 'yes' }],
    ])('returns 400 for %s', async (path, body) => {
      aggregator.addClient('client-1', () => {}, () => {}, [])

      const res = await app.fetch(new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))

      expect(res.status).toBe(400)
      await expect(readJson(res, ErrorResponseSchema)).resolves.toMatchObject({
        success: false,
        error: 'Invalid request',
      })
      expect(aggregator.hasClientDirectory('client-1', '/a')).toBe(false)
    })
  })

  describe('GET /status', () => {
    it('reports the connection status and registered clients', async () => {
      aggregator.addClient('client-1', () => {}, () => {}, [])

      const res = await app.fetch(new Request('http://localhost/status'))

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual({
        connected: 0,
        total: 0,
        clients: 1,
        directories: [],
        activeSessions: {},
      })
    })
  })

  describe('session binding', () => {
    it('ends the stream once its session is closed', async () => {
      const sessionId = 'session-revoked'
      const sessionApp = createSessionScopedApp(sessionId)

      const res = await sessionApp.fetch(new Request('http://localhost/stream'))
      const reader = responseReader(res)
      try {
        await expect(readFrame(reader)).resolves.toContain('event: connected')

        closeSessionConnections(sessionId)

        await vi.waitFor(() => expect(aggregator.getClientCount()).toBe(0))
        expect(await reader.read()).toEqual({ done: true, value: undefined })

        closeSessionConnections(sessionId)
        expect(aggregator.getClientCount()).toBe(0)
      } finally {
        await reader.cancel()
      }
    })

    it('keeps streaming while another session is closed', async () => {
      const sessionId = 'session-active'
      const sessionApp = createSessionScopedApp(sessionId)

      const res = await sessionApp.fetch(new Request('http://localhost/stream'))
      const reader = responseReader(res)
      try {
        await expect(readFrame(reader)).resolves.toContain('event: connected')

        closeSessionConnections('session-other')
        aggregator.broadcastToAll('message', '{"still":"open"}')

        await expect(readFrame(reader)).resolves.toBe('event: message\ndata: {"still":"open"}\n\n')
        expect(aggregator.getClientCount()).toBe(1)
      } finally {
        await reader.cancel()
      }

      await vi.waitFor(() => expect(aggregator.getClientCount()).toBe(0))
    })
  })
})
