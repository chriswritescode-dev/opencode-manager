import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import { createChatTerminalRoutes, createChatTerminalSocketRoutes } from '../../src/routes/chat-terminals'
import { TerminalNotFoundError } from '../../src/services/terminal'
import type { TerminalService } from '../../src/services/terminal'
import type { ChatService } from '../../src/services/chats'
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'
import { rawWebSocketHandshake } from '../helpers/raw-websocket-handshake'

const CHAT_ID = '20260304-050607-abcdef'
const UNKNOWN_CHAT_ID = '20260304-050607-aaaaaa'
const chatDirectory = '/tmp/chat'
const TRUSTED_ORIGIN = 'http://localhost:5003'

const chat = {
  id: CHAT_ID,
  directory: chatDirectory,
  filesPath: `chats/${CHAT_ID}`,
  createdAt: 0,
}

const shellTerminal = {
  id: 'pty-1',
  title: 'Terminal',
  kind: 'shell',
  cwd: chatDirectory,
  status: 'running',
} as const

function createChatService(overrides: { resolve?: ReturnType<typeof vi.fn> } = {}): ChatService {
  return {
    resolve:
      overrides.resolve ??
      vi.fn(async (chatId: string) => (chatId === CHAT_ID ? chat : null)),
  } as unknown as ChatService
}

function createService(overrides: Partial<TerminalService> = {}): TerminalService {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => shellTerminal),
    requireTerminal: vi.fn(async () => shellTerminal),
    resize: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TerminalService
}

function createApp(chatService: ChatService, service: TerminalService): Hono {
  const app = new Hono()
  app.route('/', createChatTerminalRoutes(chatService, service))
  return app
}

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('Chat Terminal Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /:chatId/terminals', () => {
    it('lists the terminals for the chat directory', async () => {
      const terminals = [{ ...shellTerminal }]
      const list = vi.fn(async () => terminals)
      const res = await createApp(createChatService(), createService({ list })).request(`/${CHAT_ID}/terminals`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ terminals })
      expect(list).toHaveBeenCalledWith(chatDirectory)
    })

    it('ignores a directory query parameter', async () => {
      const list = vi.fn(async () => [])
      const res = await createApp(createChatService(), createService({ list })).request(
        `/${CHAT_ID}/terminals?directory=/tmp/other`,
      )

      expect(res.status).toBe(200)
      expect(list).toHaveBeenCalledWith(chatDirectory)
    })

    it('returns 404 for an unknown chat', async () => {
      const list = vi.fn(async () => [])
      const res = await createApp(createChatService(), createService({ list })).request(
        `/${UNKNOWN_CHAT_ID}/terminals`,
      )

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Chat not found' })
      expect(list).not.toHaveBeenCalled()
    })
  })

  describe('POST /:chatId/terminals', () => {
    it('creates a shell with the default name in the chat directory', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ create })).request(
        `/${CHAT_ID}/terminals`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) },
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(shellTerminal)
      expect(create).toHaveBeenCalledWith(chatDirectory, { kind: 'shell', name: 'Terminal' })
    })

    it('creates a shell with the requested title and ignores the body directory', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ create })).request(
        `/${CHAT_ID}/terminals`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ directory: '/tmp/other', title: 'My shell' }),
        },
      )

      expect(res.status).toBe(200)
      expect(create).toHaveBeenCalledWith(chatDirectory, { kind: 'shell', name: 'My shell' })
    })

    it('returns 400 for an invalid body', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ create })).request(
        `/${CHAT_ID}/terminals`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ title: 'a'.repeat(81) }) },
      )

      expect(res.status).toBe(400)
      expect(create).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown chat', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ create })).request(
        `/${UNKNOWN_CHAT_ID}/terminals`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) },
      )

      expect(res.status).toBe(404)
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /:chatId/terminals/:ptyID', () => {
    it('resizes a known terminal in the chat directory', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const resize = vi.fn(async () => undefined)
      const res = await createApp(createChatService(), createService({ requireTerminal, resize })).request(
        `/${CHAT_ID}/terminals/pty-1`,
        {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ directory: '/tmp/other', cols: 80, rows: 24 }),
        },
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(requireTerminal).toHaveBeenCalledWith(chatDirectory, 'pty-1')
      expect(resize).toHaveBeenCalledWith(chatDirectory, 'pty-1', { cols: 80, rows: 24 })
    })

    it('returns 400 for invalid resize bounds', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const app = createApp(createChatService(), createService({ requireTerminal }))

      for (const body of ['{"cols":0,"rows":24}', '{"cols":80}', '{"cols":80,"rows":501}', '{"cols":1.5,"rows":24}']) {
        const res = await app.request(`/${CHAT_ID}/terminals/pty-1`, { method: 'PATCH', headers: jsonHeaders, body })
        expect(res.status).toBe(400)
      }

      expect(requireTerminal).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown PTY id', async () => {
      const requireTerminal = vi.fn(async () => {
        throw new TerminalNotFoundError('missing')
      })
      const res = await createApp(createChatService(), createService({ requireTerminal })).request(
        `/${CHAT_ID}/terminals/missing`,
        { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ cols: 80, rows: 24 }) },
      )

      expect(res.status).toBe(404)
    })

    it('returns 404 for an unknown chat', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ requireTerminal })).request(
        `/${UNKNOWN_CHAT_ID}/terminals/pty-1`,
        { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ cols: 80, rows: 24 }) },
      )

      expect(res.status).toBe(404)
      expect(requireTerminal).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /:chatId/terminals/:ptyID', () => {
    it('removes a known terminal in the chat directory', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const remove = vi.fn(async () => undefined)
      const res = await createApp(createChatService(), createService({ requireTerminal, remove })).request(
        `/${CHAT_ID}/terminals/pty-1?directory=/tmp/other`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(requireTerminal).toHaveBeenCalledWith(chatDirectory, 'pty-1')
      expect(remove).toHaveBeenCalledWith(chatDirectory, 'pty-1')
    })

    it('returns 404 for an unknown PTY id', async () => {
      const requireTerminal = vi.fn(async () => {
        throw new TerminalNotFoundError('missing')
      })
      const res = await createApp(createChatService(), createService({ requireTerminal })).request(
        `/${CHAT_ID}/terminals/missing`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(404)
    })

    it('returns 404 for an unknown chat', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const res = await createApp(createChatService(), createService({ requireTerminal })).request(
        `/${UNKNOWN_CHAT_ID}/terminals/pty-1`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(404)
      expect(requireTerminal).not.toHaveBeenCalled()
    })
  })
})

describe('Chat Terminal Socket Route', () => {
  const connect = vi.fn(async () => ({ send: vi.fn(), close: vi.fn() }))
  const resolve = vi.fn(async (chatId: string) => (chatId === CHAT_ID ? chat : null))

  let server: WebSocketTestServer
  let binding: ReturnType<typeof createNodeWebSocket>
  let port = 0

  beforeAll(async () => {
    const app = new Hono()
    binding = createNodeWebSocket({ app })
    app.route(
      '/',
      createChatTerminalSocketRoutes(
        { resolve } as unknown as ChatService,
        { connect } as unknown as TerminalService,
        binding.upgradeWebSocket,
        [TRUSTED_ORIGIN],
      ),
    )
    server = await startWebSocketServer({ app, injectWebSocket: binding.injectWebSocket })
    port = server.port
  })

  afterAll(async () => {
    binding.wss.close()
    await server.close()
  })

  beforeEach(() => {
    connect.mockClear()
    resolve.mockClear()
  })

  function connectPath(chatId = CHAT_ID, query = ''): string {
    return `/${chatId}/terminals/pty-1/connect${query}`
  }

  function openEvent(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve()
        return
      }
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('WebSocket error before open')), { once: true })
    })
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it('connects with the chat directory and parsed cursor', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${connectPath(CHAT_ID, '?cursor=-1')}`)

    await openEvent(socket)
    await waitFor(() => connect.mock.calls.length > 0)

    expect(connect).toHaveBeenCalledWith(chatDirectory, 'pty-1', -1, expect.anything())
    socket.close()
  })

  it('accepts a trusted Origin handshake', async () => {
    const outcome = await rawWebSocketHandshake({ port, path: connectPath(), origin: TRUSTED_ORIGIN })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('accepts a handshake without an Origin header', async () => {
    const outcome = await rawWebSocketHandshake({ port, path: connectPath() })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('rejects an untrusted Origin with 403', async () => {
    const outcome = await rawWebSocketHandshake({ port, path: connectPath(), origin: 'http://evil.example' })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects a malformed cursor with 400', async () => {
    const outcome = await rawWebSocketHandshake({ port, path: connectPath(CHAT_ID, '?cursor=abc') })

    expect(outcome).toEqual({ upgraded: false, status: 400 })
  })

  it('returns 404 for an unknown chat without connecting', async () => {
    const outcome = await rawWebSocketHandshake({ port, path: connectPath(UNKNOWN_CHAT_ID) })

    expect(outcome).toEqual({ upgraded: false, status: 404 })
    expect(connect).not.toHaveBeenCalled()
  })
})
