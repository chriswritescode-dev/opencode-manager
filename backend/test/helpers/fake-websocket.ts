import { vi } from 'vitest'
import type { WebSocketPeer } from '../../src/utils/websocket-bridge'

export type WebSocketFrame = string | ArrayBufferLike | ArrayBufferView
export type FakeWebSocketReadyState = 0 | 1 | 2 | 3

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

export class FakeWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSING = CLOSING
  static readonly CLOSED = CLOSED

  binaryType: 'arraybuffer' | 'nodebuffer' = 'arraybuffer'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  onopen: ((this: WebSocket, ev: Event) => void) | null = null
  onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null
  onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null
  onerror: ((this: WebSocket, ev: Event) => void) | null = null
  readonly sent: WebSocketFrame[] = []
  readonly url: string
  readonly URL: string
  readonly close: ReturnType<typeof vi.fn<(code?: number, reason?: string) => void>>
  readonly ping = vi.fn()
  readonly pong = vi.fn()
  readonly terminate = vi.fn()
  private state: FakeWebSocketReadyState = CONNECTING

  constructor(url: string) {
    super()
    this.url = url
    this.URL = url
    this.close = vi.fn((code?: number, reason?: string) => {
      void code
      void reason
      this.state = CLOSED
    })
  }

  get readyState(): FakeWebSocketReadyState {
    return this.state
  }

  get CONNECTING(): 0 {
    return CONNECTING
  }

  get OPEN(): 1 {
    return OPEN
  }

  get CLOSING(): 2 {
    return CLOSING
  }

  get CLOSED(): 3 {
    return CLOSED
  }

  send(data: WebSocketFrame): void {
    this.sent.push(data)
  }

  open(): void {
    this.state = OPEN
    this.dispatchEvent(new Event('open'))
  }

  emitMessage(data: string | ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  emitClose(code: number): void {
    this.state = CLOSED
    this.dispatchEvent(new CloseEvent('close', { code }))
  }

  emitError(): void {
    this.dispatchEvent(new Event('error'))
  }
}

export class FakePeer implements WebSocketPeer {
  readonly sent: Array<string | Uint8Array<ArrayBuffer>> = []
  readonly closeCalls: Array<{ code?: number; reason?: string }> = []
  buffered = 0

  send(data: string | Uint8Array<ArrayBuffer>): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
  }

  bufferedAmount(): number {
    return this.buffered
  }
}
