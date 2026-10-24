import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import {
  createOpenCodeServerTerminalSocketRoutes,
  type ServerTerminalServiceResolver,
} from '../../src/routes/opencode-server-terminals'
import { TerminalService } from '../../src/services/terminal'
import { OpenCodeServerNotFoundError } from '../../src/services/opencode-server-registry'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { CredentialProvider } from '../../src/services/credential-provider'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'
import { rawWebSocketHandshake } from '../helpers/raw-websocket-handshake'

const TRUSTED_ORIGIN = 'http://localhost:5003'
const SERVER_ID = 'srv_kitchen'
const UNKNOWN_SERVER_ID = 'srv_missing'
const DIRECTORY = '/home/me/app'

const ptyList = vi.fn(async ({ location }: { location: { directory: string } }) => ({
  location,
  data: [
    { id: 'pty-1', title: 'Terminal', command: 'sh', args: [], cwd: DIRECTORY, status: 'running' as const, pid: 1 },
  ],
}))
const connectToken = vi.fn(async () => ({
  location: { directory: DIRECTORY },
  data: { ticket: 'remote-ticket', expires_in: 60 },
}))

const remoteClient = {
  api: { pty: { list: ptyList, connect: { token: connectToken } } },
} as unknown as OpenCodeClient

const credentialProvider = { getGhCliEnv: vi.fn(() => ({})) } as unknown as CredentialProvider

let upstream: WebSocketTestServer
let manager: WebSocketTestServer
let managerPort = 0
let capturedUrl: URL | undefined

const upstreamApp = new Hono()
const upstreamWs = createNodeWebSocket({ app: upstreamApp })

upstreamApp.get(
  '/api/pty/:ptyID/connect',
  upstreamWs.upgradeWebSocket((c) => {
    capturedUrl = new URL(c.req.url)
    return {
      onMessage(event, ws) {
        if (typeof event.data === 'string') ws.send(event.data)
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
})

afterAll(async () => {
  upstreamWs.wss.close()
  managerWs.wss.close()
  await upstream.close()
  await manager.close()
})

describe('OpenCode Server Terminal Socket Route', () => {
  it('bridges to the remote base URL with a ticket, directory and cursor', async () => {
    const socket = new WebSocket(clientUrl('pty-1', DIRECTORY, 3))
    socket.binaryType = 'arraybuffer'
    const messages: Array<string | ArrayBuffer> = []
    socket.addEventListener('message', (event) => {
      messages.push(event.data as string | ArrayBuffer)
    })

    await openEvent(socket)
    socket.send('echo remote')
    await waitFor(() => messages.includes('echo remote'))

    expect(ptyList).toHaveBeenCalledWith({ location: { directory: DIRECTORY } })
    expect(connectToken).toHaveBeenCalledWith({
      ptyID: 'pty-1',
      location: { directory: DIRECTORY },
      'x-opencode-ticket': '1',
    })
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
