import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildUpstreamUpgradeRequest,
  createDevProxyUpgradeHandler,
} from '../../../src/services/dev-server/upgrade-handler'

const netConnectMock = vi.hoisted(() => vi.fn())
vi.mock('net', () => ({ connect: netConnectMock, default: { connect: netConnectMock } }))
vi.mock('../../../src/services/dev-server/manager', () => ({
  getDevServerPort: vi.fn(() => 5173),
}))

describe('buildUpstreamUpgradeRequest', () => {
  it('rewrites request target to rest and sets Host header', () => {
    const rawHead = [
      'GET /api/dev-proxy/1/ws-path HTTP/1.1',
      'Host: localhost:5003',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
    ].join('\r\n')

    const result = buildUpstreamUpgradeRequest(rawHead, '/ws-path', 5173)

    expect(result).toContain('GET /ws-path HTTP/1.1')
    expect(result).toContain('Host: 127.0.0.1:5173')
    expect(result).not.toContain('Host: localhost:5003')
  })

  it('preserves Upgrade, Connection, and Sec-WebSocket-* headers', () => {
    const rawHead = [
      'GET /api/dev-proxy/2/socket HTTP/1.1',
      'Host: example.com',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: json',
    ].join('\r\n')

    const result = buildUpstreamUpgradeRequest(rawHead, '/socket', 3000)

    expect(result).toContain('Upgrade: websocket')
    expect(result).toContain('Connection: Upgrade')
    expect(result).toContain('Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==')
    expect(result).toContain('Sec-WebSocket-Version: 13')
    expect(result).toContain('Sec-WebSocket-Protocol: json')
  })

  it('handles root path rest', () => {
    const rawHead = [
      'GET /api/dev-proxy/1 HTTP/1.1',
      'Host: localhost:5003',
    ].join('\r\n')

    const result = buildUpstreamUpgradeRequest(rawHead, '/', 5173)

    expect(result).toMatch(/^GET \/ HTTP\/1\.1\r\n/m)
  })

  it('preserves non-Host headers in order', () => {
    const rawHead = [
      'GET /api/dev-proxy/1/test HTTP/1.1',
      'Host: localhost:5003',
      'User-Agent: test-agent',
      'Accept: */*',
    ].join('\r\n')

    const result = buildUpstreamUpgradeRequest(rawHead, '/test', 8080)

    const userAgentIdx = result.indexOf('User-Agent: test-agent')
    const acceptIdx = result.indexOf('Accept: */*')
    expect(userAgentIdx).toBeGreaterThan(0)
    expect(acceptIdx).toBeGreaterThan(userAgentIdx)
  })

  it('returns empty string when given empty string', () => {
    expect(buildUpstreamUpgradeRequest('', '/', 5173)).toBe('')
  })

  it('handles single-line input without headers', () => {
    const result = buildUpstreamUpgradeRequest('GET /api/dev-proxy/1/ HTTP/1.1', '/', 5173)
    expect(result).toBe('GET / HTTP/1.1\r\nHost: 127.0.0.1:5173')
  })

  it('removes duplicate host headers, keeping only the new one', () => {
    const rawHead = [
      'GET /api/dev-proxy/5/app HTTP/1.1',
      'Host: first.com',
      'Host: second.com',
      'Accept: application/json',
    ].join('\r\n')

    const result = buildUpstreamUpgradeRequest(rawHead, '/app', 9999)

    const hostMatches = result.match(/^Host:/gm)
    expect(hostMatches).toHaveLength(1)
    expect(result).toContain('Host: 127.0.0.1:9999')
  })
})

describe('createDevProxyUpgradeHandler', () => {
  const mockGetSession = vi.fn()
  let auth: { api: { getSession: typeof mockGetSession } }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ session: { userId: 'u1' }, user: { id: 'u1' } })
    netConnectMock.mockReturnValue(createMockSocket())
    auth = { api: { getSession: mockGetSession } }
  })

  function createMockSocket() {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    return {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers.has(event)) handlers.set(event, [])
        handlers.get(event)!.push(handler)
      }),
      destroy: vi.fn(),
      write: vi.fn(),
      pipe: vi.fn(),
      _handlers: handlers,
    }
  }

  function triggerEvent(obj: { _handlers?: Map<string, Array<(...args: unknown[]) => void>> }, event: string, ...args: unknown[]) {
    const map = obj._handlers
    if (!map) return
    const handlers = map.get(event)
    if (handlers) {
      for (const h of handlers) h(...args)
    }
  }

  describe('URL routing', () => {
    it('destroys socket for non-proxy URL', async () => {
      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/other', method: 'GET', headers: {} }

      await handler(req as any, socket as any, Buffer.alloc(0))

      expect(socket.destroy).toHaveBeenCalledTimes(1)
      expect(mockGetSession).not.toHaveBeenCalled()
    })

    it('destroys socket for URL without repo id', async () => {
      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/', method: 'GET', headers: {} }

      await handler(req as any, socket as any, Buffer.alloc(0))

      expect(socket.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('authentication', () => {
    it('destroys socket when session lookup throws', async () => {
      mockGetSession.mockRejectedValue(new Error('auth error'))
      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/ws', method: 'GET', headers: { host: 'localhost' } }

      await handler(req as any, socket as any, Buffer.alloc(0))

      expect(socket.destroy).toHaveBeenCalledTimes(1)
    })

    it('writes 401 and destroys socket when no session', async () => {
      mockGetSession.mockResolvedValue(null)
      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/hmr', method: 'GET', headers: { host: 'localhost' } }

      await handler(req as any, socket as any, Buffer.alloc(0))

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'))
      expect(socket.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('upstream connection', () => {
    it('calls net.connect with active port and 127.0.0.1', async () => {
      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/hmr', method: 'GET', headers: { host: 'localhost' } }

      await handler(req as any, socket as any, Buffer.alloc(0))

      expect(netConnectMock).toHaveBeenCalledWith(5173, '127.0.0.1')
    })

    it('writes upstream request on connect', async () => {
      const upstreamSocket = createMockSocket()
      netConnectMock.mockReturnValue(upstreamSocket)

      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/hmr', method: 'GET', headers: { host: 'localhost', upgrade: 'websocket', connection: 'Upgrade' } }

      await handler(req as any, socket as any, Buffer.alloc(0))

      triggerEvent(upstreamSocket, 'connect')

      expect(upstreamSocket.write).toHaveBeenCalledWith(expect.stringContaining('GET /hmr HTTP/1.1'))
      expect(upstreamSocket.write).toHaveBeenCalledWith(expect.stringContaining('Host: 127.0.0.1:5173'))
    })

    it('pipes head buffer after upgrade request', async () => {
      const upstreamSocket = createMockSocket()
      netConnectMock.mockReturnValue(upstreamSocket)

      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/ws', method: 'GET', headers: { host: 'localhost' } }
      const head = Buffer.from('extra-data')

      await handler(req as any, socket as any, head)

      triggerEvent(upstreamSocket, 'connect')

      const writeMock = upstreamSocket.write as ReturnType<typeof vi.fn>
      const secondCallArg = writeMock.mock.calls[1]?.[0]
      expect(secondCallArg).toBe(head)
    })

    it('pipes socket and upstream both ways on connect', async () => {
      const upstreamSocket = createMockSocket()
      netConnectMock.mockReturnValue(upstreamSocket)

      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/ws', method: 'GET', headers: { host: 'localhost' } }

      await handler(req as any, socket as any, Buffer.alloc(0))
      triggerEvent(upstreamSocket, 'connect')

      expect(socket.pipe).toHaveBeenCalledWith(upstreamSocket)
      expect(upstreamSocket.pipe).toHaveBeenCalledWith(socket)
    })

    it('destroys socket on upstream error', async () => {
      const upstreamSocket = createMockSocket()
      netConnectMock.mockReturnValue(upstreamSocket)

      const handler = createDevProxyUpgradeHandler(auth as any, {} as any)
      const socket = createMockSocket()
      const req = { url: '/api/dev-proxy/1/ws', method: 'GET', headers: { host: 'localhost' } }

      await handler(req as any, socket as any, Buffer.alloc(0))
      triggerEvent(upstreamSocket, 'error', new Error('conn refused'))

      expect(socket.destroy).toHaveBeenCalled()
    })
  })
})
