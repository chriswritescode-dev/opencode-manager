import {
  MAX_PEER_BUFFERED_BYTES,
  MAX_UPSTREAM_BUFFERED_BYTES,
  type WebSocketBridge,
  type WebSocketPeer,
} from '../utils/websocket-bridge'

const BUFFER_LIMIT_CHARS = 256 * 1024
const REPLAY_CHUNK_CHARS = 64 * 1024
const MAX_CONNECT_ATTEMPTS = 3
const RETRY_DELAY_MS = 100
const META_FRAME_PREFIX = 0
const MAX_REGISTERED_HUBS = 64
const WEBSOCKET_OPEN = 1
const WEBSOCKET_CLOSING = 2
const WEBSOCKET_CLOSED = 3

type HubState = 'connecting' | 'open' | 'closed' | 'failed'

const META_DECODER = new TextDecoder()
const META_ENCODER = new TextEncoder()

export function encodeTerminalMetaFrame(cursor: number): Uint8Array<ArrayBuffer> {
  const payload = META_ENCODER.encode(JSON.stringify({ cursor }))
  const frame = new Uint8Array(new ArrayBuffer(payload.length + 1))
  frame[0] = META_FRAME_PREFIX
  frame.set(payload, 1)
  return frame
}

export interface TerminalHubOptions {
  openUpstream: () => Promise<WebSocket>
}

export class TerminalHub {
  private readonly decoder = new TextDecoder()
  private readonly subscribers = new Set<WebSocketPeer>()
  private readonly pendingInput: Array<string | Uint8Array<ArrayBuffer>> = []
  private socket: WebSocket | null = null
  private state: HubState = 'connecting'
  private attempts = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private pendingInputBytes = 0
  private buffer = ''
  private bufferStart = 0
  private cursor = 0

  constructor(private readonly options: TerminalHubOptions) {}

  start(): Promise<void> {
    return this.connect()
  }

  isAvailable(): boolean {
    return this.state !== 'failed'
  }

  isEnded(): boolean {
    return this.state === 'closed' || this.state === 'failed'
  }

  attach(peer: WebSocketPeer, cursor: number | undefined): WebSocketBridge {
    this.replay(peer, cursor)
    if (this.state === 'closed') {
      this.closePeer(peer, 1000)
      return { send: () => {}, close: () => {} }
    }
    this.subscribers.add(peer)
    return {
      send: (data) => this.write(data),
      close: () => {
        this.subscribers.delete(peer)
      },
    }
  }

  dispose(): void {
    this.clearRetry()
    if (this.state !== 'failed') this.state = 'closed'
    const socket = this.socket
    this.socket = null
    closeSocketQuietly(socket)
    const peers = [...this.subscribers]
    this.subscribers.clear()
    for (const peer of peers) this.closePeer(peer, 1000)
  }

  private async connect(): Promise<void> {
    if (this.state !== 'connecting') return
    this.attempts += 1
    let socket: WebSocket
    try {
      socket = await this.options.openUpstream()
    } catch {
      this.retryOrFail()
      return
    }
    if (this.state !== 'connecting') {
      closeSocketQuietly(socket)
      return
    }
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => this.handleOpen(socket))
    socket.addEventListener('message', (event) => this.handleMessage(event as MessageEvent))
    socket.addEventListener('close', () => this.handleUpstreamClosed(socket))
    socket.addEventListener('error', () => this.handleUpstreamError(socket))
    const readyState = (socket as { readyState?: number }).readyState
    if (readyState === WEBSOCKET_OPEN) {
      this.handleOpen(socket)
      return
    }
    if (readyState === WEBSOCKET_CLOSING || readyState === WEBSOCKET_CLOSED) {
      this.socket = null
      this.retryOrFail()
    }
  }

  private handleOpen(socket: WebSocket): void {
    if (this.socket !== socket || this.state !== 'connecting') return
    this.state = 'open'
    while (this.pendingInput.length > 0) {
      const item = this.pendingInput.shift()!
      this.pendingInputBytes -= byteLengthOf(item)
      try {
        socket.send(item)
      } catch {
        this.endStream()
        return
      }
    }
  }

  private handleMessage(event: MessageEvent): void {
    const data: unknown = event.data
    if (typeof data === 'string') {
      this.appendOutput(data)
      return
    }
    let bytes: Uint8Array
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else if (data instanceof Uint8Array) {
      bytes = data
    } else {
      return
    }
    if (bytes.length > 0 && bytes[0] === META_FRAME_PREFIX) {
      this.alignToCursor(bytes.subarray(1))
      return
    }
    this.appendOutput(this.decoder.decode(bytes, { stream: true }))
  }

  private handleUpstreamError(socket: WebSocket): void {
    if (this.socket !== socket || this.state !== 'connecting') return
    this.socket = null
    closeSocketQuietly(socket)
    this.retryOrFail()
  }

  private handleUpstreamClosed(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    if (this.state === 'open') {
      this.endStream()
      return
    }
    if (this.state === 'connecting') this.retryOrFail()
  }

  private retryOrFail(): void {
    if (this.state !== 'connecting') return
    if (this.attempts >= MAX_CONNECT_ATTEMPTS) {
      this.state = 'failed'
      return
    }
    this.clearRetry()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, RETRY_DELAY_MS)
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private endStream(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    const peers = [...this.subscribers]
    this.subscribers.clear()
    for (const peer of peers) this.closePeer(peer, 1000)
  }

  private alignToCursor(payload: Uint8Array): void {
    try {
      const parsed = JSON.parse(META_DECODER.decode(payload)) as { cursor?: unknown }
      if (typeof parsed.cursor !== 'number' || !Number.isSafeInteger(parsed.cursor)) return
      if (parsed.cursor < this.cursor) return
      this.cursor = parsed.cursor
      this.bufferStart = Math.max(0, parsed.cursor - this.buffer.length)
    } catch {
      return
    }
  }

  private appendOutput(chunk: string): void {
    if (chunk.length === 0) return
    this.cursor += chunk.length
    this.buffer += chunk
    const excess = this.buffer.length - BUFFER_LIMIT_CHARS
    if (excess > 0) {
      this.buffer = this.buffer.slice(excess)
      this.bufferStart += excess
    }
    for (const peer of [...this.subscribers]) this.deliver(peer, chunk)
  }

  private replay(peer: WebSocketPeer, cursor: number | undefined): void {
    const from = this.replayStart(cursor)
    const offset = Math.max(0, from - this.bufferStart)
    const replay = offset < this.buffer.length ? this.buffer.slice(offset) : ''
    for (let index = 0; index < replay.length; index += REPLAY_CHUNK_CHARS) {
      this.deliver(peer, replay.slice(index, index + REPLAY_CHUNK_CHARS))
    }
    this.deliver(peer, encodeTerminalMetaFrame(this.cursor))
  }

  private replayStart(cursor: number | undefined): number {
    if (cursor === -1) return this.cursor
    if (cursor === undefined) return this.bufferStart
    return Math.max(cursor, this.bufferStart)
  }

  private write(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void {
    if (this.state === 'closed' || this.state === 'failed') return
    const payload: string | Uint8Array<ArrayBuffer> =
      typeof data === 'string' ? data : data instanceof Uint8Array ? data : new Uint8Array(data)
    if (this.state === 'open' && this.socket) {
      try {
        this.socket.send(payload)
      } catch {
        this.endStream()
      }
      return
    }
    this.pendingInput.push(payload)
    this.pendingInputBytes += byteLengthOf(payload)
    while (this.pendingInputBytes > MAX_UPSTREAM_BUFFERED_BYTES && this.pendingInput.length > 0) {
      const dropped = this.pendingInput.shift()!
      this.pendingInputBytes -= byteLengthOf(dropped)
    }
  }

  private deliver(peer: WebSocketPeer, data: string | Uint8Array<ArrayBuffer>): void {
    try {
      peer.send(data)
    } catch {
      this.subscribers.delete(peer)
      return
    }
    if (peer.bufferedAmount() > MAX_PEER_BUFFERED_BYTES) {
      this.subscribers.delete(peer)
      this.closePeer(peer, 1013, 'Client too slow')
    }
  }

  private closePeer(peer: WebSocketPeer, code: number, reason?: string): void {
    try {
      peer.close(code, reason)
    } catch {
      return
    }
  }
}

function closeSocketQuietly(socket: { close: () => void } | null | undefined): void {
  if (!socket) return
  try {
    socket.close()
  } catch {
    return
  }
}

function byteLengthOf(data: string | Uint8Array<ArrayBuffer>): number {
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
}

export class TerminalHubRegistry {
  private readonly hubs = new Map<string, TerminalHub>()

  get(key: string): TerminalHub | undefined {
    return this.hubs.get(key)
  }

  register(key: string, hub: TerminalHub): void {
    if (this.hubs.has(key)) {
      hub.dispose()
      return
    }
    if (this.hubs.size >= MAX_REGISTERED_HUBS && !this.evict()) {
      hub.dispose()
      return
    }
    this.hubs.set(key, hub)
  }

  dispose(key: string): void {
    const hub = this.hubs.get(key)
    if (!hub) return
    this.hubs.delete(key)
    hub.dispose()
  }

  private evict(): boolean {
    const target = [...this.hubs.entries()].find(([, hub]) => hub.isEnded())
    if (!target) return false
    this.hubs.delete(target[0])
    target[1].dispose()
    return true
  }
}
