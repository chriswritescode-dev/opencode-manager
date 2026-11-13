import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { JsonValue } from '@opencode-manager/shared/utils'
import {
  createOpenCodeServerTerminalSocketRoutes,
  type ServerTerminalServiceResolver,
} from '../../src/routes/opencode-server-terminals'
import { TerminalService } from '../../src/services/terminal'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { OpenCodeServerNotFoundError } from '../../src/services/opencode-server-registry'
import { CredentialProvider } from '../../src/services/credential-provider'
import type { Session } from '../../src/auth'
import {
  closeSessionConnections,
  SESSION_CONNECTION_CLOSE_CODE,
  SESSION_CONNECTION_CLOSE_REASON,
} from '../../src/services/session-connections'
import { createFetchStub, type FetchStub } from '../helpers/fetch-stub'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createTestDatabase } from '../helpers/test-database'
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'
import { rawWebSocketHandshake } from '../helpers/raw-websocket-handshake'

const TRUSTED_ORIGIN = 'http://localhost:5003'
const SERVER_ID = 'srv_kitchen'
const UNKNOWN_SERVER_ID = 'srv_missing'
const DIRECTORY = '/home/me/app'

function jsonResponse(payload: JsonValue): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const fetchFn: FetchStub = createFetchStub(async (input) => {
  const url = new URL(String(input))
  if (url.pathname === '/api/pty') {
    return jsonResponse({
      location: { directory: DIRECTORY },
      data: [
        { id: 'pty-1', title: 'Terminal', command: 'sh', args: [], cwd: DIRECTORY, status: 'running', pid: 1 },
      ],
    })
  }
  if (url.pathname === '/api/pty/pty-1/connect-token') {
    return jsonResponse({
      location: { directory: DIRECTORY },
      data: { ticket: 'remote-ticket', expires_in: 60 },
    })
  }
  return new Response(null, { status: 404 })
})

const remoteClient = new FetchOpenCodeClient({
  baseUrl: 'https://remote.internal',
  basicAuth: null,
  defaultDirectory: false,
  fetchFn,
})

const db = createTestDatabase()
const credentialProvider = new CredentialProvider(db)

let upstream: WebSocketTestServer
let manager: WebSocketTestServer
let sessionServer: WebSocketTestServer
let managerPort = 0
let sessionPort = 0
let capturedUrl: URL | undefined

const upstreamApp = new Hono()
const upstreamWs = createNodeWebSocket({ app: upstreamApp })

upstreamApp.get(
  '/api/pty/:ptyID/connect',
  upstreamWs.upgradeWebSocket((c) => {
    capturedUrl = new URL(c.req.url)
    return {
      onMessage(event, ws) {
        const data = event.data
        if (data instanceof Blob) {
          void data.text().then((text) => ws.send(text))
          return
        }
        if (data instanceof ArrayBuffer) {
          ws.send(data)
          return
        }
        ws.send(String(data))
      },
    }
  }),
)

const managerApp = new Hono()
const managerWs = createNodeWebSocket({ app: managerApp })

const terminalService = new TerminalService(
  { client: remoteClient, baseUrl: () => `http://127.0.0.1:${upstream.port}`, includeLocalEnv: false },
  credentialProvider,
  createStubRepoEnvService(),
)

const resolveTerminalService: ServerTerminalServiceResolver = (serverId) => {
  if (serverId === UNKNOWN_SERVER_ID) throw new OpenCodeServerNotFoundError(serverId)
  return terminalService
}

managerApp.route(
  '/',
  createOpenCodeServerTerminalSocketRoutes(resolveTerminalService, managerWs.upgradeWebSocket, [TRUSTED_ORIGIN]),
)

const SESSION_ID = 'session-server-terminal'
const sessionApp = new Hono<{ Variables: { session: Session['session'] } }>()
const sessionWs = createNodeWebSocket({ app: sessionApp })
sessionApp.use('/*', async (c, next) => {
  c.set('session', {
    id: SESSION_ID,
    userId: 'user-1',
    token: 'token-server-terminal',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await next()
})
sessionApp.route(
  '/',
  createOpenCodeServerTerminalSocketRoutes(resolveTerminalService, sessionWs.upgradeWebSocket, [TRUSTED_ORIGIN]),
)

function clientUrl(ptyID: string, directory = DIRECTORY, cursor?: number): string {
  const url = new URL(`ws://127.0.0.1:${managerPort}/${SERVER_ID}/terminals/${ptyID}/connect`)
  url.searchParams.set('directory', directory)
  if (cursor !== undefined) url.searchParams.set('cursor', String(cursor))
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeAll(async () => {
  upstream = await startWebSocketServer({ app: upstreamApp, injectWebSocket: upstreamWs.injectWebSocket })
  manager = await startWebSocketServer({ app: managerApp, injectWebSocket: managerWs.injectWebSocket })
  managerPort = manager.port
  sessionServer = await startWebSocketServer({ app: sessionApp, injectWebSocket: sessionWs.injectWebSocket })
  sessionPort = sessionServer.port
})

afterAll(async () => {
  upstreamWs.wss.close()
  managerWs.wss.close()
  sessionWs.wss.close()
  await upstream.close()
  await manager.close()
  await sessionServer.close()
  db.close()
})

describe('OpenCode Server Terminal Socket Route', () => {
  it('bridges to the remote base URL with a ticket, directory and cursor', async () => {
    const socket = new WebSocket(clientUrl('pty-1', DIRECTORY, 3))
    const messages: unknown[] = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data)
    })

    await openEvent(socket)
    socket.send('echo remote')
    await waitFor(() => messages.includes('echo remote'))

    const [listCall, tokenCall] = fetchFn.mock.calls
    const listUrl = new URL(String(listCall?.[0]))
    expect(listUrl.pathname).toBe('/api/pty')
    expect(listUrl.searchParams.get('location[directory]')).toBe(DIRECTORY)
    const tokenUrl = new URL(String(tokenCall?.[0]))
    expect(tokenUrl.pathname).toBe('/api/pty/pty-1/connect-token')
    expect(new Headers(tokenCall?.[1]?.headers).get('x-opencode-ticket')).toBe('1')
    expect(capturedUrl?.searchParams.get('ticket')).toBe('remote-ticket')
    expect(capturedUrl?.searchParams.get('location[directory]')).toBe(DIRECTORY)
    expect(capturedUrl?.searchParams.get('cursor')).toBe('3')

    socket.close()
  })

  it('rejects an untrusted origin before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: managerPort,
      path: `/${SERVER_ID}/terminals/pty-1/connect?directory=${encodeURIComponent(DIRECTORY)}`,
      origin: 'http://localhost:5004',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects the local server before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: managerPort,
      path: `/${LOCAL_OPENCODE_SERVER_ID}/terminals/pty-1/connect?directory=${encodeURIComponent(DIRECTORY)}`,
    })

    expect(outcome).toEqual({ upgraded: false, status: 400 })
  })

  it('returns 404 for an unknown server before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: managerPort,
      path: `/${UNKNOWN_SERVER_ID}/terminals/pty-1/connect?directory=${encodeURIComponent(DIRECTORY)}`,
    })

    expect(outcome).toEqual({ upgraded: false, status: 404 })
  })

  it('rejects a relative directory before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: managerPort,
      path: `/${SERVER_ID}/terminals/pty-1/connect?directory=relative/path`,
    })

    expect(outcome).toEqual({ upgraded: false, status: 400 })
  })
})

describe('OpenCode Server Terminal Socket session binding', () => {
  it('closes the socket when its session is deleted', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${sessionPort}/${SERVER_ID}/terminals/pty-1/connect?directory=${encodeURIComponent(DIRECTORY)}`)
    const messages: unknown[] = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data)
    })

    await openEvent(socket)
    socket.send('echo session')
    await waitFor(() => messages.includes('echo session'))

    const closeEvent = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener('close', (event) => resolve(event), { once: true })
    })

    closeSessionConnections(SESSION_ID)

    const event = await closeEvent
    expect(event.code).toBe(SESSION_CONNECTION_CLOSE_CODE)
    expect(event.reason).toBe(SESSION_CONNECTION_CLOSE_REASON)
  })
})
