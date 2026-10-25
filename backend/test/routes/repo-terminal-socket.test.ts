import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createNodeWebSocket } from '@hono/node-ws'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { createRepoTerminalSocketRoutes } from '../../src/routes/repo-terminal-socket'
import { TerminalService } from '../../src/services/terminal'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { CredentialProvider } from '../../src/services/credential-provider'
import type { Session } from '../../src/auth'
import {
  closeSessionConnections,
  registerSessionConnection,
  SESSION_CONNECTION_CLOSE_CODE,
  SESSION_CONNECTION_CLOSE_REASON,
} from '../../src/services/session-connections'
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'
import { rawWebSocketHandshake } from '../helpers/raw-websocket-handshake'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'

vi.mock('../../src/services/repo', () => ({
  resolveRepoOrAssistant: vi.fn(),
  resolveRepoWorkingDirectory: vi.fn(),
  listRepoSiblings: vi.fn(),
}))

import { resolveRepoOrAssistant, resolveRepoWorkingDirectory, listRepoSiblings } from '../../src/services/repo'

const readyRepo = { id: 1, fullPath: '/tmp/repo', cloneStatus: 'ready' } as Repo
const database = {} as Database
const gitAuthService = { getGitEnvironment: vi.fn(() => ({})) } as unknown as GitAuthService

function createPty(id: string) {
  return { id, title: 'Terminal', command: 'sh', args: [], cwd: '/tmp/repo', status: 'running' as const, pid: 1 }
}

const openCodeClient = {
  api: {
    pty: {
      list: vi.fn(async ({ location }: { location: { directory: string } }) => ({
        location,
        data: [createPty('pty-1'), createPty('pty-4404')],
      })),
      connect: {
        token: vi.fn(async () => ({
          location: { directory: '/tmp/repo' },
          data: { ticket: 'stub-ticket', expires_in: 60 },
        })),
      },
    },
  },
} as unknown as OpenCodeClient

const credentialProvider = { getGhCliEnv: vi.fn(() => ({})) } as unknown as CredentialProvider

let upstream: WebSocketTestServer
let manager: WebSocketTestServer
let authenticated: WebSocketTestServer
let sessionServer: WebSocketTestServer
let managerPort = 0
let upstreamBase = ''
let capturedUrl: URL | undefined

const upstreamApp = new Hono()
const upstreamWs = createNodeWebSocket({ app: upstreamApp })
const textEncoder = new TextEncoder()

upstreamApp.get(
  '/api/pty/:ptyID/connect',
  upstreamWs.upgradeWebSocket((c) => {
    capturedUrl = new URL(c.req.url)
    const ptyID = c.req.param('ptyID')
    return {
      onOpen(_event, ws) {
        if (ptyID === 'pty-4404') {
          ws.close(4404, 'gone')
          return
        }
        ws.send(new Uint8Array([0, ...textEncoder.encode('{"cursor":0}')]))
      },
      onMessage(event, ws) {
        if (typeof event.data === 'string') ws.send(event.data)
      },
    }
  }),
)

const terminalService = new TerminalService(
  { client: openCodeClient, baseUrl: () => upstreamBase, includeLocalEnv: true },
  credentialProvider,
  createStubRepoEnvService(),
)

const managerApp = new Hono()
const managerWs = createNodeWebSocket({ app: managerApp })
managerApp.route(
  '/',
  createRepoTerminalSocketRoutes(
    database,
    gitAuthService,
    openCodeClient,
    terminalService,
    managerWs.upgradeWebSocket,
  ),
)

const TRUSTED_ORIGIN = 'http://localhost:5003'
const authenticatedApp = new Hono()
const authenticatedWs = createNodeWebSocket({ app: authenticatedApp })
authenticatedApp.use('/*', cors())
authenticatedApp.use('/*', async (c, next) => {
  const cookie = c.req.header('cookie') ?? ''
  if (!cookie.includes('session=valid')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
authenticatedApp.route(
  '/',
  createRepoTerminalSocketRoutes(
    database,
    gitAuthService,
    openCodeClient,
    terminalService,
    authenticatedWs.upgradeWebSocket,
    [TRUSTED_ORIGIN],
  ),
)

let authenticatedPort = 0

const SESSION_ID = 'session-terminal'
const sessionApp = new Hono<{ Variables: { session: Session['session'] } }>()
const sessionWs = createNodeWebSocket({ app: sessionApp })
sessionApp.use('/*', async (c, next) => {
  c.set('session', {
    id: SESSION_ID,
    userId: 'user-1',
    token: 'token-terminal',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await next()
})
sessionApp.route(
  '/',
  createRepoTerminalSocketRoutes(
    database,
    gitAuthService,
    openCodeClient,
    terminalService,
    sessionWs.upgradeWebSocket,
  ),
)

let sessionPort = 0

function clientUrl(ptyID: string, directory = '/tmp/repo'): string {
  const url = new URL(`ws://127.0.0.1:${managerPort}/1/terminals/${ptyID}/connect`)
  url.searchParams.set('directory', directory)
  return url.toString()
}

function sessionClientUrl(ptyID: string, directory = '/tmp/repo'): string {
  const url = new URL(`ws://127.0.0.1:${sessionPort}/1/terminals/${ptyID}/connect`)
  url.searchParams.set('directory', directory)
  return url.toString()
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

function settle(socket: WebSocket): Promise<'open' | 'error' | 'close'> {
  return new Promise((resolve) => {
    socket.addEventListener('open', () => resolve('open'), { once: true })
    socket.addEventListener('error', () => resolve('error'), { once: true })
    socket.addEventListener('close', () => resolve('close'), { once: true })
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeAll(async () => {
  upstream = await startWebSocketServer({ app: upstreamApp, injectWebSocket: upstreamWs.injectWebSocket })
  upstreamBase = `http://127.0.0.1:${upstream.port}`

  manager = await startWebSocketServer({ app: managerApp, injectWebSocket: managerWs.injectWebSocket })
  managerPort = manager.port

  authenticated = await startWebSocketServer({ app: authenticatedApp, injectWebSocket: authenticatedWs.injectWebSocket })
  authenticatedPort = authenticated.port

  sessionServer = await startWebSocketServer({ app: sessionApp, injectWebSocket: sessionWs.injectWebSocket })
  sessionPort = sessionServer.port

  vi.mocked(resolveRepoOrAssistant).mockImplementation((_db, id) => (id === 1 ? readyRepo : null))
  vi.mocked(resolveRepoWorkingDirectory).mockImplementation(async (_repo, directory) => {
    if (directory === undefined || directory === '/tmp/repo') return '/tmp/repo'
    return null
  })
  vi.mocked(listRepoSiblings).mockResolvedValue([])
})

afterAll(async () => {
  upstreamWs.wss.close()
  managerWs.wss.close()
  authenticatedWs.wss.close()
  sessionWs.wss.close()
  await upstream.close()
  await manager.close()
  await authenticated.close()
  await sessionServer.close()
})

describe('Repo Terminal Socket Route', () => {
  it('bridges the binary meta frame and echoes text through the upstream', async () => {
    const socket = new WebSocket(clientUrl('pty-1'))
    socket.binaryType = 'arraybuffer'
    const messages: Array<string | ArrayBuffer> = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data as string | ArrayBuffer)
    })

    await openEvent(socket)
    await waitFor(() => messages.length === 1)

    const meta = messages[0]
    expect(meta).toBeInstanceOf(ArrayBuffer)
    const bytes = new Uint8Array(meta as ArrayBuffer)
    expect(bytes[0]).toBe(0)
    expect(new TextDecoder().decode(bytes.subarray(1))).toBe('{"cursor":0}')

    socket.send('echo me')
    await waitFor(() => messages.length === 2)
    expect(messages[1]).toBe('echo me')

    expect(capturedUrl?.searchParams.get('ticket')).toBe('stub-ticket')
    expect(capturedUrl?.searchParams.get('location[directory]')).toBe('/tmp/repo')

    socket.close()
  })

  it('fails the handshake for a directory outside the repository', async () => {
    const socket = new WebSocket(clientUrl('pty-1', '/tmp/other'))

    const outcome = await settle(socket)

    expect(outcome).not.toBe('open')
    socket.close()
  })

  it('propagates an upstream 4404 close to the client', async () => {
    const socket = new WebSocket(clientUrl('pty-4404'))

    const closeEvent = await new Promise<CloseEvent>((resolve, reject) => {
      socket.addEventListener('close', (event) => resolve(event), { once: true })
      socket.addEventListener('error', () => reject(new Error('WebSocket error before close')), { once: true })
    })

    expect(closeEvent.code).toBe(4404)
  })
})

describe('Repo Terminal Socket session binding', () => {
  it('closes the socket when its session is deleted', async () => {
    const socket = new WebSocket(sessionClientUrl('pty-1'))
    socket.binaryType = 'arraybuffer'
    const messages: Array<string | ArrayBuffer> = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data as string | ArrayBuffer)
    })

    await openEvent(socket)
    await waitFor(() => messages.length === 1)

    const closeEvent = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener('close', (event) => resolve(event), { once: true })
    })
    const otherSessionClose = vi.fn()
    registerSessionConnection('session-terminal-other', otherSessionClose)

    closeSessionConnections(SESSION_ID)

    const event = await closeEvent
    expect(event.code).toBe(SESSION_CONNECTION_CLOSE_CODE)
    expect(event.reason).toBe(SESSION_CONNECTION_CLOSE_REASON)
    expect(otherSessionClose).not.toHaveBeenCalled()
    closeSessionConnections('session-terminal-other')
  })

  it('unregisters the socket so a repeated session close does not fire again', async () => {
    const socket = new WebSocket(sessionClientUrl('pty-1'))
    socket.binaryType = 'arraybuffer'
    const messages: Array<string | ArrayBuffer> = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data as string | ArrayBuffer)
    })

    await openEvent(socket)
    await waitFor(() => messages.length === 1)

    const closeEvent = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener('close', (event) => resolve(event), { once: true })
    })
    const survivor = vi.fn()
    registerSessionConnection(SESSION_ID, survivor)

    closeSessionConnections(SESSION_ID)
    await closeEvent

    expect(survivor).toHaveBeenCalledTimes(1)
    closeSessionConnections(SESSION_ID)
    expect(survivor).toHaveBeenCalledTimes(1)
  })
})

describe('Repo Terminal Socket Origin validation', () => {
  const path = `/1/terminals/pty-1/connect?directory=${encodeURIComponent('/tmp/repo')}`

  it('accepts a trusted Origin with a valid session cookie', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path,
      origin: TRUSTED_ORIGIN,
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('allows a non-browser client without an Origin header', async () => {
    const outcome = await rawWebSocketHandshake({ port: authenticatedPort, path, cookie: 'session=valid' })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('rejects an untrusted same-site Origin before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path,
      origin: 'http://localhost:5004',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects a null Origin before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path,
      origin: 'null',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects the upgrade without a session cookie', async () => {
    const outcome = await rawWebSocketHandshake({ port: authenticatedPort, path, origin: TRUSTED_ORIGIN })

    expect(outcome).toEqual({ upgraded: false, status: 401 })
  })
})
