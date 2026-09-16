import { describe, it, expect, vi, beforeEach } from 'vitest'

const sseMocks = vi.hoisted(() => ({
  addClient: vi.fn(),
  addDirectories: vi.fn(),
  removeDirectories: vi.fn(),
  setClientVisibility: vi.fn(),
  getConnectionStatus: vi.fn(),
  getClientCount: vi.fn(),
  getActiveDirectories: vi.fn(),
  getActiveSessions: vi.fn(),
}))

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: sseMocks,
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createSSERoutes } from '../../src/routes/sse'
import { encodeSSEFrame } from '../../src/utils/sse-frame'

const decoder = new TextDecoder()

async function readChunk(reader: { read(): Promise<{ value?: Uint8Array }> }): Promise<string> {
  const { value } = await reader.read()
  return decoder.decode(value)
}

describe('SSE Routes', () => {
  let app: ReturnType<typeof createSSERoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    sseMocks.addClient.mockReturnValue(() => {})
    sseMocks.addDirectories.mockReturnValue(true)
    sseMocks.removeDirectories.mockReturnValue(true)
    sseMocks.setClientVisibility.mockReturnValue(true)
    sseMocks.getConnectionStatus.mockReturnValue({ connected: 1, total: 1 })
    sseMocks.getClientCount.mockReturnValue(0)
    sseMocks.getActiveDirectories.mockReturnValue([])
    sseMocks.getActiveSessions.mockReturnValue({})

    app = createSSERoutes()
  })

  describe('GET /stream', () => {
    it('streams the connected frame and registers the client with parsed directories', async () => {
      const cleanup = vi.fn()
      sseMocks.addClient.mockReturnValue(cleanup)
      sseMocks.getConnectionStatus.mockReturnValue({ connected: 1, total: 2 })

      const res = await app.fetch(new Request('http://localhost/stream?directories=/one,/two,,/three'))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache, no-store, no-transform')
      expect(res.headers.get('connection')).toBe('keep-alive')
      expect(res.headers.get('x-accel-buffering')).toBe('no')

      const reader = res.body!.getReader()
      try {
        const first = await readChunk(reader)
        expect(first).toContain('event: connected')
        expect(first).toContain('"directories":["/one","/two","/three"]')
        expect(first).toContain('"connected":1')
        expect(first).toContain('"total":2')

        const clientId = first.match(/"clientId":"([^"]+)"/)?.[1]
        expect(clientId).toMatch(/^client_\d+_[a-z0-9]+$/)

        expect(sseMocks.addClient).toHaveBeenCalledTimes(1)
        const [idArg, callbackArg, frameWriterArg, directoriesArg] = sseMocks.addClient.mock.calls[0] as [
          string,
          (event: string, data: string) => void,
          (frame: Uint8Array) => void,
          string[],
        ]
        expect(idArg).toBe(clientId)
        expect(directoriesArg).toEqual(['/one', '/two', '/three'])

        callbackArg('message', '{"from":"callback"}')
        const second = await readChunk(reader)
        expect(second).toBe('event: message\ndata: {"from":"callback"}\n\n')

        frameWriterArg(encodeSSEFrame('message', '{"from":"frame"}'))
        const third = await readChunk(reader)
        expect(third).toBe('event: message\ndata: {"from":"frame"}\n\n')
      } finally {
        await reader.cancel()
      }

      expect(cleanup).toHaveBeenCalledTimes(1)
    })

    it('defaults directories to an empty array when the query is absent', async () => {
      const cleanup = vi.fn()
      sseMocks.addClient.mockReturnValue(cleanup)

      const res = await app.fetch(new Request('http://localhost/stream'))
      const reader = res.body!.getReader()
      try {
        const first = await readChunk(reader)
        expect(first).toContain('event: connected')
        expect(first).toContain('"directories":[]')
      } finally {
        await reader.cancel()
      }

      expect(sseMocks.addClient).toHaveBeenCalledWith(
        expect.stringMatching(/^client_/),
        expect.any(Function),
        expect.any(Function),
        [],
      )
      expect(cleanup).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /subscribe', () => {
    it('subscribes directories for an existing client', async () => {
      sseMocks.addDirectories.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', directories: ['/a', '/b'] }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(sseMocks.addDirectories).toHaveBeenCalledWith('client-1', ['/a', '/b'])
    })

    it('returns 400 for an invalid subscribe body', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: '', directories: 'not-an-array' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { success: boolean; error: string }
      expect(json.success).toBe(false)
      expect(json.error).toBe('Invalid request')
      expect(sseMocks.addDirectories).not.toHaveBeenCalled()
    })

    it('returns 404 when the client is not found', async () => {
      sseMocks.addDirectories.mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', directories: ['/a'] }),
      }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('POST /unsubscribe', () => {
    it('unsubscribes directories for an existing client', async () => {
      sseMocks.removeDirectories.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', directories: ['/a'] }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(sseMocks.removeDirectories).toHaveBeenCalledWith('client-1', ['/a'])
    })

    it('returns 400 for an invalid unsubscribe body', async () => {
      const res = await app.fetch(new Request('http://localhost/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directories: [] }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { success: boolean; error: string }
      expect(json.success).toBe(false)
      expect(json.error).toBe('Invalid request')
      expect(sseMocks.removeDirectories).not.toHaveBeenCalled()
    })

    it('returns 404 when the client is not found', async () => {
      sseMocks.removeDirectories.mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', directories: ['/a'] }),
      }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('POST /visibility', () => {
    it('sets visibility with an explicit active session id', async () => {
      sseMocks.setClientVisibility.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', visible: true, activeSessionId: 'session-9' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(sseMocks.setClientVisibility).toHaveBeenCalledWith('client-1', true, 'session-9')
    })

    it('defaults the active session id to null when omitted', async () => {
      sseMocks.setClientVisibility.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', visible: false }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(sseMocks.setClientVisibility).toHaveBeenCalledWith('client-1', false, null)
    })

    it('returns 400 for an invalid visibility body', async () => {
      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-1', visible: 'yes' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { success: boolean; error: string }
      expect(json.success).toBe(false)
      expect(json.error).toBe('Invalid request')
      expect(sseMocks.setClientVisibility).not.toHaveBeenCalled()
    })

    it('returns 404 when the client is not found', async () => {
      sseMocks.setClientVisibility.mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'missing', visible: true }),
      }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('GET /status', () => {
    it('returns the merged connection status and counts', async () => {
      sseMocks.getConnectionStatus.mockReturnValue({ connected: 1, total: 2 })
      sseMocks.getClientCount.mockReturnValue(4)
      sseMocks.getActiveDirectories.mockReturnValue(['/a', '/b'])
      sseMocks.getActiveSessions.mockReturnValue({ '/a': ['session-1'] })

      const res = await app.fetch(new Request('http://localhost/status'))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        connected: 1,
        total: 2,
        clients: 4,
        directories: ['/a', '/b'],
        activeSessions: { '/a': ['session-1'] },
      })
    })
  })
})
