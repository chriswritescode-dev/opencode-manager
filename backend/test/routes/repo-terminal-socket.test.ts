import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createNodeWebSocket } from '@hono/node-ws'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { createRepoTerminalSocketRoutes } from '../../src/routes/repo-terminal-socket'
import { TerminalService } from '../../src/services/terminal'
import { CredentialProvider } from '../../src/services/credential-provider'
import type { Session } from '../../src/auth'
import {
  closeSessionConnections,
  registerSessionConnection,
  SESSION_CONNECTION_CLOSE_CODE,
  SESSION_CONNECTION_CLOSE_REASON,
} from '../../src/services/session-connections'
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'
import { rawWebSocketHandshake } from '../helpers/raw-websocket-handshake'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createGitAuthService } from '../helpers/git-fixtures'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

type PtyInfo = Awaited<ReturnType<OpenCodeApi['pty']['list']>>['data'][number]

function buildPty(id: string, cwd: string): PtyInfo {
  return { id, title: 'Terminal', command: 'sh', args: [], cwd, status: 'running', pid: 1 }
}

let workspace: TempWorkspace
let db: Database
let repoId = 0
let repoDirectory = ''

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
        const payload = z.string().safeParse(event.data)
        if (payload.success) ws.send(payload.data)
      },
    }
  }),
)

let terminalService: TerminalService
let openCodeClient: ReturnType<typeof createStubOpenCodeClient>

const managerApp = new Hono()
const managerWs = createNodeWebSocket({ app: managerApp })

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

let sessionPort = 0

function clientUrl(ptyID: string, directory = repoDirectory): string {
  const url = new URL(`ws://127.0.0.1:${managerPort}/${repoId}/terminals/${ptyID}/connect`)
  url.searchParams.set('directory', directory)
  return url.toString()
}

function sessionClientUrl(ptyID: string, directory = repoDirectory): string {
  const url = new URL(`ws://127.0.0.1:${sessionPort}/${repoId}/terminals/${ptyID}/connect`)
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

const WebSocketFrameSchema = z.union([z.string(), z.instanceof(ArrayBuffer)])

function collectFrames(socket: WebSocket): Array<string | ArrayBuffer> {
  socket.binaryType = 'arraybuffer'
  const messages: Array<string | ArrayBuffer> = []
  socket.addEventListener('message', (event) => {
    const frame = WebSocketFrameSchema.safeParse(event.data)
    if (frame.success) messages.push(frame.data)
  })
  return messages
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
  workspace = createTempWorkspace('ocm-terminal-socket-')
  db = createTestDatabase()
  const repo = seedRepo(db, { localPath: 'repo' })
  repoId = repo.id
  repoDirectory = repo.fullPath
  mkdirSync(repoDirectory, { recursive: true })

  openCodeClient = createStubOpenCodeClient({
    api: {
      pty: {
        list: async (input) => ({
          location: { directory: input?.location?.directory ?? repoDirectory },
          data: [buildPty('pty-1', repoDirectory), buildPty('pty-4404', repoDirectory)],
        }),
        connect: {
          token: async () => ({
            location: { directory: repoDirectory },
            data: { ticket: 'stub-ticket', expires_in: 60 },
          }),
        },
      },
    },
  })
  terminalService = new TerminalService(
    { client: openCodeClient, baseUrl: () => upstreamBase, includeLocalEnv: true },
    new CredentialProvider(db),
    createStubRepoEnvService(),
  )
  const gitAuthService = createGitAuthService()

  upstream = await startWebSocketServer({ app: upstreamApp, injectWebSocket: upstreamWs.injectWebSocket })
  upstreamBase = `http://127.0.0.1:${upstream.port}`

  managerApp.route(
    '/',
    createRepoTerminalSocketRoutes(db, gitAuthService, openCodeClient, terminalService, managerWs.upgradeWebSocket),
  )
  manager = await startWebSocketServer({ app: managerApp, injectWebSocket: managerWs.injectWebSocket })
  managerPort = manager.port

  authenticatedApp.route(
    '/',
    createRepoTerminalSocketRoutes(
      db,
      gitAuthService,
      openCodeClient,
      terminalService,
      authenticatedWs.upgradeWebSocket,
      [TRUSTED_ORIGIN],
    ),
  )
  authenticated = await startWebSocketServer({ app: authenticatedApp, injectWebSocket: authenticatedWs.injectWebSocket })
  authenticatedPort = authenticated.port

  sessionApp.route(
    '/',
    createRepoTerminalSocketRoutes(db, gitAuthService, openCodeClient, terminalService, sessionWs.upgradeWebSocket),
  )
  sessionServer = await startWebSocketServer({ app: sessionApp, injectWebSocket: sessionWs.injectWebSocket })
  sessionPort = sessionServer.port
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
  db.close()
  workspace.restore()
})

describe('Repo Terminal Socket Route', () => {
  it('bridges the binary meta frame and echoes text through the upstream', async () => {
    const socket = new WebSocket(clientUrl('pty-1'))
    const messages = collectFrames(socket)

    await openEvent(socket)
    await waitFor(() => messages.length === 1)

    const meta = messages[0]
    expect(meta).toBeInstanceOf(ArrayBuffer)
    if (!(meta instanceof ArrayBuffer)) throw new Error('expected the meta frame to be binary')
    const bytes = new Uint8Array(meta)
    expect(bytes[0]).toBe(0)
    expect(new TextDecoder().decode(bytes.subarray(1))).toBe('{"cursor":0}')

    socket.send('echo me')
    await waitFor(() => messages.length === 2)
    expect(messages[1]).toBe('echo me')

    expect(capturedUrl?.searchParams.get('ticket')).toBe('stub-ticket')
    expect(capturedUrl?.searchParams.get('location[directory]')).toBe(repoDirectory)

    socket.close()
  })

  it('fails the handshake for a directory outside the repository', async () => {
    const socket = new WebSocket(clientUrl('pty-1', path.join(workspace.path, 'other')))

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
    const messages = collectFrames(socket)

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
    const messages = collectFrames(socket)

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
  function handshakePath(): string {
    return `/${repoId}/terminals/pty-1/connect?directory=${encodeURIComponent(repoDirectory)}`
  }

  it('accepts a trusted Origin with a valid session cookie', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path: handshakePath(),
      origin: TRUSTED_ORIGIN,
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('allows a non-browser client without an Origin header', async () => {
    const outcome = await rawWebSocketHandshake({ port: authenticatedPort, path: handshakePath(), cookie: 'session=valid' })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('rejects an untrusted same-site Origin before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path: handshakePath(),
      origin: 'http://localhost:5004',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects a null Origin before the upgrade', async () => {
    const outcome = await rawWebSocketHandshake({
      port: authenticatedPort,
      path: handshakePath(),
      origin: 'null',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects the upgrade without a session cookie', async () => {
    const outcome = await rawWebSocketHandshake({ port: authenticatedPort, path: handshakePath(), origin: TRUSTED_ORIGIN })

    expect(outcome).toEqual({ upgraded: false, status: 401 })
  })
})
