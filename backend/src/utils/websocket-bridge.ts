import type { WSContext, WSEvents } from 'hono/ws'
import { getErrorMessage } from './error-utils'

export interface WebSocketPeer {
  send(data: string | Uint8Array<ArrayBuffer>): void
  close(code?: number, reason?: string): void
  bufferedAmount(): number
}

export interface WebSocketBridge {
  send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void
  close(): void
}

export interface WebSocketBridgeOptions {
  initialMessages?: Array<string | ArrayBuffer>
  connectTimeoutMs?: number
}

export interface PendingUpstream {
  attach(peer: WebSocketPeer): WebSocketBridge
  abandon(): void
}

export interface ConnectUpstreamOptions {
  protocols?: string[]
  timeoutMs?: number
}

export const MAX_PEER_BUFFERED_BYTES = 4 * 1024 * 1024

export const MAX_UPSTREAM_BUFFERED_BYTES = 4 * 1024 * 1024

export const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000

const MAX_CLOSE_REASON_BYTES = 120

export function peerBufferedAmount(peer: { raw?: unknown }): number {
  const raw = peer.raw as { bufferedAmount?: number } | undefined
  return typeof raw?.bufferedAmount === 'number' ? raw.bufferedAmount : 0
}

export function toWebSocketPeer(ws: WSContext): WebSocketPeer {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    bufferedAmount: () => peerBufferedAmount(ws),
  }
}

export function isAllowedUpgradeOrigin(
  origin: string | undefined,
  trustedOrigins: readonly string[],
): boolean {
  if (origin === undefined) return true
  if (origin === 'null') return false
  return trustedOrigins.includes(origin)
}

function truncateCloseReason(message: string): string {
  const bytes = Buffer.from(message, 'utf8')
  if (bytes.length <= MAX_CLOSE_REASON_BYTES) return message
  return bytes.subarray(0, MAX_CLOSE_REASON_BYTES).toString('utf8')
}

export async function forwardPeerMessage(
  bridge: WebSocketBridge,
  data: string | Blob | ArrayBufferLike,
): Promise<void> {
  if (typeof data === 'string') {
    bridge.send(data)
    return
  }
  if (data instanceof Blob) {
    bridge.send(await data.arrayBuffer())
    return
  }
  if (data instanceof ArrayBuffer) {
    bridge.send(data)
  }
}

function defaultMapCloseCode(code: number): number {
  if (code === 1000) return 1000
  if (code >= 4000 && code <= 4999) return code
  return 1011
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  return data instanceof Uint8Array ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data)
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer
}

export function bridgeWebSocket(
  upstream: WebSocket,
  peer: WebSocketPeer,
  options: WebSocketBridgeOptions = {},
): WebSocketBridge {
  upstream.binaryType = 'arraybuffer'

  const queue: Array<string | Uint8Array> = []
  let queuedBytes = 0
  let upstreamOpen = false
  let finished = false
  let connectTimer: ReturnType<typeof setTimeout> | undefined

  const clearConnectTimer = (): void => {
    if (connectTimer !== undefined) {
      clearTimeout(connectTimer)
      connectTimer = undefined
    }
  }

  const finish = (): void => {
    finished = true
    clearConnectTimer()
  }

  const deliverToPeer = (data: string | ArrayBuffer | Uint8Array): void => {
    if (typeof data === 'string') {
      peer.send(data)
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      peer.send(toBytes(data))
    } else {
      return
    }
    if (peer.bufferedAmount() > MAX_PEER_BUFFERED_BYTES) {
      finish()
      upstream.close()
      peer.close(1013, 'Client too slow')
    }
  }

  const failUpstream = (code: number, reason: string): void => {
    if (finished) return
    finish()
    upstream.close()
    peer.close(code, reason)
  }

  upstream.addEventListener('open', () => {
    if (finished) return
    upstreamOpen = true
    clearConnectTimer()
    while (queue.length > 0) {
      upstream.send(queue.shift()!)
      if (upstream.bufferedAmount > MAX_UPSTREAM_BUFFERED_BYTES) {
        failUpstream(1013, 'Upstream too slow')
        return
      }
    }
  })

  upstream.addEventListener('message', (event) => {
    if (finished) return
    deliverToPeer((event as MessageEvent).data)
  })

  upstream.addEventListener('close', (event) => {
    if (finished) return
    finish()
    peer.close(defaultMapCloseCode((event as CloseEvent).code))
  })

  upstream.addEventListener('error', () => {
    if (finished) return
    finish()
    peer.close(1011)
  })

  const readyState = upstream.readyState
  if (readyState === WebSocket.OPEN) {
    upstreamOpen = true
  } else if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) {
    finish()
    peer.close(1011)
  } else {
    connectTimer = setTimeout(() => {
      failUpstream(1011, 'Upstream connect timeout')
    }, options.connectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS)
  }

  if (!finished && options.initialMessages) {
    for (const message of options.initialMessages) {
      if (finished) break
      deliverToPeer(message)
    }
  }

  return {
    send(data) {
      if (finished) return
      const payload = typeof data === 'string' ? data : toBytes(data)
      if (upstreamOpen) {
        upstream.send(payload)
        if (upstream.bufferedAmount > MAX_UPSTREAM_BUFFERED_BYTES) {
          failUpstream(1013, 'Upstream too slow')
        }
        return
      }
      queue.push(payload)
      queuedBytes += typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength
      if (queuedBytes > MAX_UPSTREAM_BUFFERED_BYTES) {
        failUpstream(1013, 'Upstream too slow')
      }
    },
    close() {
      if (finished) return
      finish()
      upstream.close()
    },
  }
}

export function connectUpstreamWebSocket(
  url: string,
  options: ConnectUpstreamOptions = {},
): Promise<PendingUpstream> {
  return new Promise<PendingUpstream>((resolve, reject) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url, options.protocols)
    } catch (error) {
      reject(error)
      return
    }
    socket.binaryType = 'arraybuffer'

    const timeoutMs = options.timeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS
    const buffered: Array<string | ArrayBuffer> = []
    let settled = false
    let attached = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const detachListeners = (): void => {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('close', handleClose)
    }

    const closeSocket = (): void => {
      socket.close()
    }

    const rejectBeforeOpen = (error: unknown): void => {
      if (settled) return
      settled = true
      clearTimer()
      detachListeners()
      closeSocket()
      reject(error)
    }

    const handleOpen = (): void => {
      if (settled) return
      settled = true
      clearTimer()
      timer = setTimeout(() => {
        if (!attached) closeSocket()
      }, timeoutMs)
      resolve({
        attach(peer) {
          if (attached) throw new Error('Upstream WebSocket is already attached')
          attached = true
          clearTimer()
          detachListeners()
          return bridgeWebSocket(socket, peer, { initialMessages: buffered.splice(0, buffered.length) })
        },
        abandon() {
          if (attached) return
          attached = true
          clearTimer()
          detachListeners()
          closeSocket()
        },
      })
    }

    const handleMessage = (event: Event): void => {
      if (attached) return
      const data = (event as MessageEvent).data
      if (typeof data === 'string') {
        buffered.push(data)
      } else if (data instanceof ArrayBuffer) {
        buffered.push(data)
      } else if (data instanceof Uint8Array) {
        buffered.push(toArrayBuffer(data))
      }
    }

    const handleError = (): void => {
      rejectBeforeOpen(new Error(`Failed to connect to upstream WebSocket: ${url}`))
    }

    const handleClose = (): void => {
      rejectBeforeOpen(new Error(`Upstream WebSocket closed before connect: ${url}`))
    }

    timer = setTimeout(() => {
      rejectBeforeOpen(new Error(`Upstream WebSocket connect timed out: ${url}`))
    }, timeoutMs)

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('error', handleError)
    socket.addEventListener('close', handleClose)
  })
}

export function createBridgedSocketEvents(
  openBridge: (peer: WebSocketPeer) => WebSocketBridge | Promise<WebSocketBridge>,
): WSEvents {
  let bridge: WebSocketBridge | undefined
  let closed = false
  let connectPromise: Promise<void> = Promise.resolve()

  return {
    onOpen(_event, ws) {
      connectPromise = (async () => {
        const connected = await openBridge(toWebSocketPeer(ws))
        if (closed) {
          connected.close()
          return
        }
        bridge = connected
      })().catch((error: unknown) => {
        if (closed) return
        ws.close(1011, truncateCloseReason(getErrorMessage(error)))
      })
    },
    async onMessage(event) {
      await connectPromise
      if (!bridge) return
      await forwardPeerMessage(bridge, event.data)
    },
    onClose() {
      closed = true
      bridge?.close()
    },
  }
}
