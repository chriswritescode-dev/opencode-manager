import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import type { Duplex } from 'node:stream'
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import {
  createPreviewGatewayApp,
  PreviewSessionStore,
} from '../../../src/services/preview/gateway'
import { startWebSocketServer, type WebSocketTestServer } from '../../helpers/websocket-server'

class HandshakeError extends Error {
  constructor(readonly statusCode: number) {
    super(`WebSocket handshake failed with status ${statusCode}`)
  }
}

interface ReceivedMessage {
  type: 'text' | 'binary'
  data: string | Buffer
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = randomBytes(4)
  const length = payload.length
  let header: Buffer
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] = masked[i]! ^ maskKey[i % 4]!
  }
  return Buffer.concat([header, maskKey, masked])
}

class RawWebSocketClient {
  private buffer = Buffer.alloc(0)
  private readonly messages: ReceivedMessage[] = []

  private constructor(private readonly socket: Duplex, head: Buffer) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    if (head.length > 0) this.onData(head)
  }

  static connect(options: { port: number; path: string; protocol?: string; cookie?: string }): Promise<RawWebSocketClient> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      }
      if (options.protocol) headers['Sec-WebSocket-Protocol'] = options.protocol
      if (options.cookie) headers.Cookie = options.cookie

      const request = httpRequest({
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: 'GET',
        headers,
      })

      let settled = false
      request.on('upgrade', (_res, socket, head) => {
        settled = true
        resolve(new RawWebSocketClient(socket, head))
      })
      request.on('response', (res) => {
        settled = true
        res.resume()
        reject(new HandshakeError(res.statusCode ?? 0))
      })
      request.on('error', (error) => {
        if (!settled) reject(error)
      })
      request.end()
    })
  }

  send(text: string): void {
    this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
  }

  async waitForMessage(index: number, timeoutMs = 5000): Promise<ReceivedMessage> {
    const deadline = Date.now() + timeoutMs
    while (this.messages.length <= index) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for message ${index}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return this.messages[index]!
  }

  close(): void {
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)))
    } catch {
      this.socket.destroy()
    }
    this.socket.destroy()
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 2) return
      const first = this.buffer[0]!
      const second = this.buffer[1]!
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) return
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        length = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }
      let maskKey: Buffer | null = null
      if (masked) {
        if (this.buffer.length < offset + 4) return
        maskKey = this.buffer.subarray(offset, offset + 4)
        offset += 4
      }
      if (this.buffer.length < offset + length) return
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length))
      this.buffer = this.buffer.subarray(offset + length)
      if (maskKey) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] = payload[i]! ^ maskKey[i % 4]!
        }
      }
      if (opcode === 0x1) {
        this.messages.push({ type: 'text', data: payload.toString('utf8') })
      } else if (opcode === 0x2) {
        this.messages.push({ type: 'binary', data: payload })
      }
    }
  }
}

let upstream: WebSocketTestServer
let gatewayServer: WebSocketTestServer
let upstreamPort = 0
let gatewayPort = 0
let capturedUrl: URL | undefined
let capturedProtocol: string | undefined

const store = new PreviewSessionStore()
const gateway = createPreviewGatewayApp(store)

const upstreamApp = new Hono()
const upstreamWs = createNodeWebSocket({ app: upstreamApp })

upstreamApp.get(
  '/*',
  upstreamWs.upgradeWebSocket((c) => {
    capturedUrl = new URL(c.req.url)
    capturedProtocol = c.req.header('sec-websocket-protocol')
    return {
      onMessage(event, ws) {
        if (typeof event.data === 'string') ws.send(event.data)
      },
    }
  }),
)

upstreamApp.all('/*', (c) => c.json({ path: c.req.path, search: new URL(c.req.url).search }))

async function openSessionCookie(): Promise<string> {
  const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })
  const res = await gateway.app.request(
    `http://localhost/__ocm_preview/start?token=${encodeURIComponent(token)}`,
    { redirect: 'manual' },
  )
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected a Set-Cookie header')
  return setCookie.split(';')[0]!
}

beforeAll(async () => {
  upstream = await startWebSocketServer({ app: upstreamApp, injectWebSocket: upstreamWs.injectWebSocket })
  upstreamPort = upstream.port

  gatewayServer = await startWebSocketServer({ app: gateway.app, injectWebSocket: gateway.injectWebSocket })
  gatewayPort = gatewayServer.port
})

afterAll(async () => {
  upstreamWs.wss.close()
  await upstream.close()
  await gatewayServer.close()
})

describe('Preview Gateway WebSocket', () => {
  it('bridges an authenticated upgrade and forwards the protocol, path and query upstream', async () => {
    const cookie = await openSessionCookie()

    const client = await RawWebSocketClient.connect({
      port: gatewayPort,
      path: '/hmr?token=abc',
      protocol: 'vite-hmr',
      cookie,
    })

    client.send('hello hmr')
    const message = await client.waitForMessage(0)

    expect(message.type).toBe('text')
    expect(message.data).toBe('hello hmr')
    expect(capturedUrl?.pathname).toBe('/hmr')
    expect(capturedUrl?.search).toBe('?token=abc')
    expect(capturedProtocol).toBe('vite-hmr')

    client.close()
  })

  it('fails the handshake for an upgrade without a preview session cookie', async () => {
    let failure: HandshakeError | undefined
    try {
      await RawWebSocketClient.connect({ port: gatewayPort, path: '/hmr', protocol: 'vite-hmr' })
    } catch (error) {
      failure = error as HandshakeError
    }

    expect(failure).toBeInstanceOf(HandshakeError)
    expect(failure?.statusCode).toBe(401)
  })

  it('still proxies a plain HTTP GET on the same path', async () => {
    const cookie = await openSessionCookie()

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/echo?q=2`, { headers: { cookie } })

    expect(res.status).toBe(200)
    const body = await res.json() as { path: string; search: string }
    expect(body.path).toBe('/echo')
    expect(body.search).toBe('?q=2')
  })
})
