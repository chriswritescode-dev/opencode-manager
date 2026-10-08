import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
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
import { startWebSocketServer, type WebSocketTestServer } from '../helpers/websocket-server'

vi.mock('../../src/services/repo', () => ({
  resolveRepoOrAssistant: vi.fn(),
  resolveRepoWorkingDirectory: vi.fn(),
  getSiblingRepos: vi.fn(),
}))

import { resolveRepoOrAssistant, resolveRepoWorkingDirectory, getSiblingRepos } from '../../src/services/repo'

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

const terminalService = new TerminalService(openCodeClient, credentialProvider, () => upstreamBase)

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

interface RawHandshakeResult {
  upgraded: boolean
  status?: number
}

function rawHandshake(options: { port: number; path: string; origin?: string; cookie?: string }): Promise<RawHandshakeResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
    }
    if (options.origin !== undefined) headers.Origin = options.origin
    if (options.cookie) headers.Cookie = options.cookie

    const request = httpRequest({ host: '127.0.0.1', port: options.port, path: options.path, method: 'GET', headers })
    let settled = false
    request.on('upgrade', (_res, socket) => {
      settled = true
      socket.destroy()
      resolve({ upgraded: true })
    })
    request.on('response', (res) => {
      settled = true
      res.resume()
      resolve({ upgraded: false, status: res.statusCode })
    })
    request.on('error', (error) => {
      if (!settled) reject(error)
    })
    request.end()
  })
}

function clientUrl(ptyID: string, directory = '/tmp/repo'): string {
  const url = new URL(`ws://127.0.0.1:${managerPort}/1/terminals/${ptyID}/connect`)
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

  vi.mocked(resolveRepoOrAssistant).mockImplementation((_db, id) => (id === 1 ? readyRepo : null))
  vi.mocked(resolveRepoWorkingDirectory).mockImplementation(async (_repo, directory) => {
    if (directory === undefined || directory === '/tmp/repo') return '/tmp/repo'
    return null
  })
  vi.mocked(getSiblingRepos).mockResolvedValue([])
})

afterAll(async () => {
  upstreamWs.wss.close()
  managerWs.wss.close()
  authenticatedWs.wss.close()
  await upstream.close()
  await manager.close()
  await authenticated.close()
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

describe('Repo Terminal Socket Origin validation', () => {
  const path = `/1/terminals/pty-1/connect?directory=${encodeURIComponent('/tmp/repo')}`

  it('accepts a trusted Origin with a valid session cookie', async () => {
    const outcome = await rawHandshake({
      port: authenticatedPort,
      path,
      origin: TRUSTED_ORIGIN,
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('allows a non-browser client without an Origin header', async () => {
    const outcome = await rawHandshake({ port: authenticatedPort, path, cookie: 'session=valid' })

    expect(outcome).toEqual({ upgraded: true })
  })

  it('rejects an untrusted same-site Origin before the upgrade', async () => {
    const outcome = await rawHandshake({
      port: authenticatedPort,
      path,
      origin: 'http://localhost:5004',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects a null Origin before the upgrade', async () => {
    const outcome = await rawHandshake({
      port: authenticatedPort,
      path,
      origin: 'null',
      cookie: 'session=valid',
    })

    expect(outcome).toEqual({ upgraded: false, status: 403 })
  })

  it('rejects the upgrade without a session cookie', async () => {
    const outcome = await rawHandshake({ port: authenticatedPort, path, origin: TRUSTED_ORIGIN })

    expect(outcome).toEqual({ upgraded: false, status: 401 })
  })
})
