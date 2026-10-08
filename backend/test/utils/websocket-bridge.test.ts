import { describe, it, expect, vi, afterEach } from 'vitest'
import type { WSContext } from 'hono/ws'
import {
  bridgeWebSocket,
  connectUpstreamWebSocket,
  createBridgedSocketEvents,
  forwardPeerMessage,
  isAllowedUpgradeOrigin,
  toWebSocketPeer,
  MAX_PEER_BUFFERED_BYTES,
  MAX_UPSTREAM_BUFFERED_BYTES,
  type WebSocketBridge,
  type WebSocketPeer,
} from '../../src/utils/websocket-bridge'

type Listener = (event: unknown) => void

class FakeUpstream {
  binaryType: 'blob' | 'arraybuffer' = 'blob'
  readyState = 0
  bufferedAmount = 0
  sent: Array<string | Uint8Array> = []
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  close = vi.fn()

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

interface FakePeer extends WebSocketPeer {
  sent: Array<string | Uint8Array>
  closeCalls: Array<{ code?: number; reason?: string }>
  buffered: number
}

function createPeer(): FakePeer {
  const peer: FakePeer = {
    sent: [],
    closeCalls: [],
    buffered: 0,
    send(data) {
      peer.sent.push(data)
    },
    close(code, reason) {
      peer.closeCalls.push({ code, reason })
    },
    bufferedAmount() {
      return peer.buffered
    },
  }
  return peer
}

function asUpstream(upstream: FakeUpstream): WebSocket {
  return upstream as unknown as WebSocket
}

interface FakeWs {
  raw: { bufferedAmount: number }
  sent: Array<string | ArrayBuffer | Uint8Array>
  closeCalls: Array<{ code?: number; reason?: string }>
  send(data: string | ArrayBuffer | Uint8Array): void
  close(code?: number, reason?: string): void
}

function createWs(): FakeWs {
  const ws: FakeWs = {
    raw: { bufferedAmount: 0 },
    sent: [],
    closeCalls: [],
    send(data) {
      ws.sent.push(data)
    },
    close(code, reason) {
      ws.closeCalls.push({ code, reason })
    },
  }
  return ws
}

function asWsContext(ws: FakeWs): WSContext {
  return ws as unknown as WSContext
}

interface FakeBridge extends WebSocketBridge {
  sent: Array<string | ArrayBuffer | Uint8Array>
  closeCalls: number
}

function createBridge(): FakeBridge {
  const bridge: FakeBridge = {
    sent: [],
    closeCalls: 0,
    send(data) {
      bridge.sent.push(data)
    },
    close() {
      bridge.closeCalls += 1
    },
  }
  return bridge
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

class ControllableUpstream {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: ControllableUpstream[] = []

  binaryType: 'blob' | 'arraybuffer' = 'blob'
  readyState = ControllableUpstream.CONNECTING
  bufferedAmount = 0
  sent: Array<string | Uint8Array> = []
  closeCalls = 0
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    ControllableUpstream.instances.push(this)
  }

  static last(): ControllableUpstream {
    const instance = ControllableUpstream.instances.at(-1)
    if (!instance) throw new Error('No ControllableUpstream instance')
    return instance
  }

  static reset(): void {
    ControllableUpstream.instances = []
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
    this.readyState = ControllableUpstream.CLOSED
  }

  open(): void {
    this.readyState = ControllableUpstream.OPEN
    this.emit('open', {})
  }

  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bridgeWebSocket', () => {
  it('requests arraybuffer frames from the upstream', () => {
    const upstream = new FakeUpstream()
    const bridge = bridgeWebSocket(asUpstream(upstream), createPeer())
    expect(upstream.binaryType).toBe('arraybuffer')
    bridge.close()
  })

  it('queues client sends until the upstream opens and preserves order', () => {
    const upstream = new FakeUpstream()
    const bridge = bridgeWebSocket(asUpstream(upstream), createPeer())

    bridge.send('first')
    bridge.send(new Uint8Array([1, 2]))
    expect(upstream.sent).toEqual([])

    upstream.emit('open', {})

    expect(upstream.sent).toEqual(['first', new Uint8Array([1, 2])])
  })

  it('forwards text as text and binary as bytes to the peer', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer)

    upstream.emit('message', { data: 'plain text' })
    upstream.emit('message', { data: new Uint8Array([0, 1, 2]).buffer })

    expect(peer.sent[0]).toBe('plain text')
    expect(peer.sent[1]).toEqual(new Uint8Array([0, 1, 2]))
    bridge.close()
  })

  it('passes a normal close through and maps abnormal codes to 1011', () => {
    const normalUpstream = new FakeUpstream()
    const normalPeer = createPeer()
    bridgeWebSocket(asUpstream(normalUpstream), normalPeer)
    normalUpstream.emit('close', { code: 4404 })
    expect(normalPeer.closeCalls).toEqual([{ code: 4404, reason: undefined }])

    const cleanUpstream = new FakeUpstream()
    const cleanPeer = createPeer()
    bridgeWebSocket(asUpstream(cleanUpstream), cleanPeer)
    cleanUpstream.emit('close', { code: 1000 })
    expect(cleanPeer.closeCalls).toEqual([{ code: 1000, reason: undefined }])

    const abnormalUpstream = new FakeUpstream()
    const abnormalPeer = createPeer()
    bridgeWebSocket(asUpstream(abnormalUpstream), abnormalPeer)
    abnormalUpstream.emit('close', { code: 1006 })
    expect(abnormalPeer.closeCalls).toEqual([{ code: 1011, reason: undefined }])
  })

  it('closes the peer with 1011 on an upstream error', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    bridgeWebSocket(asUpstream(upstream), peer)

    upstream.emit('error', {})

    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])
  })

  it('closes the upstream and peer with 1013 when the peer buffer overflows', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES + 1

    bridgeWebSocket(asUpstream(upstream), peer)
    upstream.emit('message', { data: 'overflow' })

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Client too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)

    upstream.emit('close', { code: 1000 })
    expect(peer.closeCalls).toHaveLength(1)
  })

  it('keeps bridging while the peer buffer stays within the limit', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES

    const bridge = bridgeWebSocket(asUpstream(upstream), peer)
    upstream.emit('message', { data: 'within limit' })

    expect(peer.sent).toEqual(['within limit'])
    expect(peer.closeCalls).toEqual([])
    expect(upstream.close).not.toHaveBeenCalled()
    bridge.close()
  })

  it('closes the upstream only once and ignores later sends', () => {
    const upstream = new FakeUpstream()
    const bridge = bridgeWebSocket(asUpstream(upstream), createPeer())

    bridge.close()
    bridge.close()
    bridge.send('after close')

    expect(upstream.close).toHaveBeenCalledTimes(1)
    expect(upstream.sent).toEqual([])
  })

  it('treats an already-open upstream as open immediately', () => {
    const upstream = new FakeUpstream()
    upstream.readyState = WebSocket.OPEN
    const bridge = bridgeWebSocket(asUpstream(upstream), createPeer())

    bridge.send('immediate')

    expect(upstream.sent).toEqual(['immediate'])
    bridge.close()
  })

  it('closes the peer with 1011 when the upstream is already closed', () => {
    const upstream = new FakeUpstream()
    upstream.readyState = WebSocket.CLOSED
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer)

    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])

    bridge.send('ignored')
    expect(upstream.sent).toEqual([])
  })

  it('closes both sides with 1013 when queued client bytes exceed the cap', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer)

    bridge.send('a'.repeat(MAX_UPSTREAM_BUFFERED_BYTES + 1))

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })

  it('closes both sides with 1013 when the upstream buffer exceeds the cap after a send', () => {
    const upstream = new FakeUpstream()
    upstream.readyState = WebSocket.OPEN
    upstream.bufferedAmount = MAX_UPSTREAM_BUFFERED_BYTES + 1
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer)

    bridge.send('payload')

    expect(upstream.sent).toEqual(['payload'])
    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
  })

  it('closes both sides with 1013 when the upstream buffer overflows during a queued flush', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer)

    bridge.send('queued')
    upstream.bufferedAmount = MAX_UPSTREAM_BUFFERED_BYTES + 1
    upstream.emit('open', {})

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })

  it('closes both sides with 1011 when the upstream does not open in time', () => {
    vi.useFakeTimers()
    const upstream = new FakeUpstream()
    const peer = createPeer()
    bridgeWebSocket(asUpstream(upstream), peer, { connectTimeoutMs: 50 })

    vi.advanceTimersByTime(50)

    expect(upstream.close).toHaveBeenCalledTimes(1)
    expect(peer.closeCalls).toEqual([{ code: 1011, reason: 'Upstream connect timeout' }])
  })

  it('clears the connect deadline once the upstream opens', () => {
    vi.useFakeTimers()
    const upstream = new FakeUpstream()
    const peer = createPeer()
    bridgeWebSocket(asUpstream(upstream), peer, { connectTimeoutMs: 50 })

    upstream.emit('open', {})
    vi.advanceTimersByTime(1000)

    expect(peer.closeCalls).toEqual([])
    expect(upstream.close).not.toHaveBeenCalled()
  })

  it('delivers initialMessages before later upstream messages', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    const bridge = bridgeWebSocket(asUpstream(upstream), peer, {
      initialMessages: ['early text', new Uint8Array([9]).buffer],
    })

    upstream.emit('message', { data: 'later' })

    expect(peer.sent).toEqual(['early text', new Uint8Array([9]), 'later'])
    bridge.close()
  })

  it('applies the peer buffer cap while delivering initialMessages', () => {
    const upstream = new FakeUpstream()
    const peer = createPeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES + 1

    bridgeWebSocket(asUpstream(upstream), peer, { initialMessages: ['overflow'] })

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Client too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })
})

describe('connectUpstreamWebSocket', () => {
  it('resolves on open, forwards protocols and buffers messages until attach', async () => {
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream', { protocols: ['vite-hmr'] })
    const socket = ControllableUpstream.last()
    expect(socket.protocols).toEqual(['vite-hmr'])
    expect(socket.binaryType).toBe('arraybuffer')

    socket.open()
    const pending = await promise

    socket.emit('message', { data: 'early' })
    const peer = createPeer()
    const bridge = pending.attach(peer)

    expect(peer.sent).toEqual(['early'])

    socket.emit('message', { data: new Uint8Array([1, 2]).buffer })
    expect(peer.sent[1]).toEqual(new Uint8Array([1, 2]))

    bridge.close()
  })

  it('rejects and closes the socket when the upstream errors before open', async () => {
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableUpstream.last()
    socket.emit('error', {})

    await expect(promise).rejects.toThrow('Failed to connect')
    expect(socket.closeCalls).toBe(1)
  })

  it('rejects and closes the socket when the upstream closes before open', async () => {
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableUpstream.last()
    socket.emit('close', {})

    await expect(promise).rejects.toThrow('closed before connect')
    expect(socket.closeCalls).toBe(1)
  })

  it('rejects and closes the socket when the connect times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream', { timeoutMs: 50 })
    const socket = ControllableUpstream.last()
    const rejection = expect(promise).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(50)
    await rejection

    expect(socket.closeCalls).toBe(1)
  })

  it('closes the socket when attach is not called within the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream', { timeoutMs: 50 })
    const socket = ControllableUpstream.last()
    socket.open()
    const pending = await promise

    expect(pending).toBeDefined()
    await vi.advanceTimersByTimeAsync(50)

    expect(socket.closeCalls).toBe(1)
  })

  it('abandon closes the socket', async () => {
    vi.stubGlobal('WebSocket', ControllableUpstream)
    ControllableUpstream.reset()

    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableUpstream.last()
    socket.open()
    const pending = await promise

    pending.abandon()

    expect(socket.closeCalls).toBe(1)
  })

  it('rejects when the WebSocket constructor throws', async () => {
    vi.stubGlobal('WebSocket', class {
      constructor() {
        throw new Error('constructor failed')
      }
    })

    await expect(connectUpstreamWebSocket('ws://upstream')).rejects.toThrow('constructor failed')
  })
})

describe('createBridgedSocketEvents', () => {
  it('opens the bridge and forwards messages after the connect resolves', async () => {
    const bridge = createBridge()
    const events = createBridgedSocketEvents(() => Promise.resolve(bridge))
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    await events.onMessage!({ data: 'hello' } as MessageEvent, asWsContext(ws))

    expect(bridge.sent).toEqual(['hello'])
  })

  it('closes the client with 1011 when the bridge factory throws synchronously', async () => {
    const events = createBridgedSocketEvents(() => {
      throw new Error('boom')
    })
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    await flushAsync()

    expect(ws.closeCalls).toEqual([{ code: 1011, reason: 'boom' }])
  })

  it('closes the client with 1011 when the bridge factory rejects', async () => {
    const events = createBridgedSocketEvents(() => Promise.reject(new Error('nope')))
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    await flushAsync()

    expect(ws.closeCalls).toEqual([{ code: 1011, reason: 'nope' }])
  })

  it('does not close the client when it already closed', async () => {
    const events = createBridgedSocketEvents(() => {
      throw new Error('late')
    })
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    events.onClose!({} as CloseEvent, asWsContext(ws))
    await flushAsync()

    expect(ws.closeCalls).toEqual([])
  })

  it('closes a bridge that resolves after the client closed', async () => {
    let resolveBridge!: (bridge: WebSocketBridge) => void
    const events = createBridgedSocketEvents(
      () => new Promise<WebSocketBridge>((resolve) => {
        resolveBridge = resolve
      }),
    )
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    events.onClose!({} as CloseEvent, asWsContext(ws))

    const bridge = createBridge()
    resolveBridge(bridge)
    await flushAsync()

    expect(bridge.closeCalls).toBe(1)
  })

  it('waits for the connect before forwarding messages', async () => {
    let resolveBridge!: (bridge: WebSocketBridge) => void
    const events = createBridgedSocketEvents(
      () => new Promise<WebSocketBridge>((resolve) => {
        resolveBridge = resolve
      }),
    )
    const ws = createWs()

    events.onOpen!({} as Event, asWsContext(ws))
    const messagePromise = events.onMessage!({ data: 'queued' } as MessageEvent, asWsContext(ws))

    const bridge = createBridge()
    resolveBridge(bridge)
    await messagePromise

    expect(bridge.sent).toEqual(['queued'])
  })
})

describe('toWebSocketPeer', () => {
  it('forwards send, close and bufferedAmount to the context', () => {
    const ws = createWs()
    ws.raw.bufferedAmount = 42
    const peer = toWebSocketPeer(asWsContext(ws))

    peer.send('data')
    peer.send(new Uint8Array([1]))
    peer.close(1000, 'done')

    expect(ws.sent).toEqual(['data', new Uint8Array([1])])
    expect(ws.closeCalls).toEqual([{ code: 1000, reason: 'done' }])
    expect(peer.bufferedAmount()).toBe(42)
  })
})

describe('isAllowedUpgradeOrigin', () => {
  it('allows a missing origin, rejects null and otherwise checks the list', () => {
    expect(isAllowedUpgradeOrigin(undefined, ['http://localhost:5003'])).toBe(true)
    expect(isAllowedUpgradeOrigin('null', ['http://localhost:5003'])).toBe(false)
    expect(isAllowedUpgradeOrigin('http://localhost:5003', ['http://localhost:5003'])).toBe(true)
    expect(isAllowedUpgradeOrigin('http://localhost:5004', ['http://localhost:5003'])).toBe(false)
  })
})

describe('forwardPeerMessage', () => {
  function createSentBridge(sent: Array<string | ArrayBuffer | Uint8Array>): WebSocketBridge {
    return {
      send(data) {
        sent.push(data)
      },
      close() {},
    }
  }

  it('forwards strings, ArrayBuffers and Blobs to the bridge', async () => {
    const sent: Array<string | ArrayBuffer | Uint8Array> = []
    const bridge = createSentBridge(sent)

    await forwardPeerMessage(bridge, 'plain text')
    await forwardPeerMessage(bridge, new Uint8Array([1, 2]).buffer)
    await forwardPeerMessage(bridge, new Blob(['blob body']))

    expect(sent[0]).toBe('plain text')
    expect(sent[1]).toEqual(new Uint8Array([1, 2]).buffer)
    expect(new TextDecoder().decode(sent[2] as ArrayBuffer)).toBe('blob body')
  })
})
