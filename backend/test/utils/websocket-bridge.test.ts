import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WSContext } from 'hono/ws'
import { FakePeer, FakeWebSocket, type WebSocketFrame } from '../helpers/fake-websocket'
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
} from '../../src/utils/websocket-bridge'

class ControllableWebSocket extends FakeWebSocket {
  static instances: ControllableWebSocket[] = []

  readonly protocols: string | string[] | undefined

  constructor(url: string, protocols?: string | string[]) {
    super(url)
    this.protocols = protocols
    ControllableWebSocket.instances.push(this)
  }

  static last(): ControllableWebSocket {
    const instance = ControllableWebSocket.instances.at(-1)
    if (!instance) throw new Error('No ControllableWebSocket instance')
    return instance
  }
}

interface CapturedContext {
  ws: WSContext
  sent: WebSocketFrame[]
  closeCalls: Array<{ code?: number; reason?: string }>
  raw: { bufferedAmount: number }
}

function createContext(readyState: 0 | 1 | 2 | 3 = 1): CapturedContext {
  const sent: WebSocketFrame[] = []
  const closeCalls: Array<{ code?: number; reason?: string }> = []
  const raw = { bufferedAmount: 0 }
  const ws = new WSContext({
    send: (data) => {
      sent.push(data)
    },
    close: (code, reason) => {
      closeCalls.push({ code, reason })
    },
    raw,
    readyState,
  })
  return { ws, sent, closeCalls, raw }
}

class RecordingBridge implements WebSocketBridge {
  sent: WebSocketFrame[] = []
  closeCalls = 0

  send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
  }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  ControllableWebSocket.instances = []
  vi.stubGlobal('WebSocket', ControllableWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bridgeWebSocket', () => {
  it('requests arraybuffer frames from the upstream', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const bridge = bridgeWebSocket(upstream, new FakePeer())

    expect(upstream.binaryType).toBe('arraybuffer')
    bridge.close()
  })

  it('queues client sends until the upstream opens and preserves order', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const bridge = bridgeWebSocket(upstream, new FakePeer())

    bridge.send('first')
    bridge.send(new Uint8Array([1, 2]))
    expect(upstream.sent).toEqual([])

    upstream.open()

    expect(upstream.sent).toEqual(['first', new Uint8Array([1, 2])])
  })

  it('forwards text as text and binary as bytes to the peer', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer)

    upstream.emitMessage('plain text')
    upstream.emitMessage(new Uint8Array([0, 1, 2]).buffer)

    expect(peer.sent).toEqual(['plain text', new Uint8Array([0, 1, 2])])
    bridge.close()
  })

  it.each([
    [4404, 4404],
    [1000, 1000],
    [1006, 1011],
    [1001, 1011],
  ])('maps upstream close code %i to peer close code %i', (upstreamCode, peerCode) => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    bridgeWebSocket(upstream, peer)

    upstream.emitClose(upstreamCode)

    expect(peer.closeCalls).toEqual([{ code: peerCode, reason: undefined }])
  })

  it('closes the peer with 1011 on an upstream error', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    bridgeWebSocket(upstream, peer)

    upstream.emitError()

    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])
  })

  it('closes the upstream and peer with 1013 when the peer buffer overflows', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES + 1

    bridgeWebSocket(upstream, peer)
    upstream.emitMessage('overflow')

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Client too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)

    upstream.emitClose(1000)
    expect(peer.closeCalls).toHaveLength(1)
  })

  it('keeps bridging while the peer buffer stays within the limit', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES

    const bridge = bridgeWebSocket(upstream, peer)
    upstream.emitMessage('within limit')

    expect(peer.sent).toEqual(['within limit'])
    expect(peer.closeCalls).toEqual([])
    expect(upstream.close).not.toHaveBeenCalled()
    bridge.close()
  })

  it('closes the upstream only once and ignores later sends', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const bridge = bridgeWebSocket(upstream, new FakePeer())

    bridge.close()
    bridge.close()
    bridge.send('after close')

    expect(upstream.close).toHaveBeenCalledTimes(1)
    expect(upstream.sent).toEqual([])
  })

  it('treats an already-open upstream as open immediately', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    upstream.open()
    const bridge = bridgeWebSocket(upstream, new FakePeer())

    bridge.send('immediate')

    expect(upstream.sent).toEqual(['immediate'])
    bridge.close()
  })

  it('closes the peer with 1011 when the upstream is already closed', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    upstream.emitClose(1000)
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer)

    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])

    bridge.send('ignored')
    expect(upstream.sent).toEqual([])
  })

  it('closes both sides with 1013 when queued client bytes exceed the cap', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer)

    bridge.send('a'.repeat(MAX_UPSTREAM_BUFFERED_BYTES + 1))

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })

  it('closes both sides with 1013 when the upstream buffer exceeds the cap after a send', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    upstream.open()
    upstream.bufferedAmount = MAX_UPSTREAM_BUFFERED_BYTES + 1
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer)

    bridge.send('payload')

    expect(upstream.sent).toEqual(['payload'])
    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
  })

  it('closes both sides with 1013 when the upstream buffer overflows during a queued flush', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer)

    bridge.send('queued')
    upstream.bufferedAmount = MAX_UPSTREAM_BUFFERED_BYTES + 1
    upstream.open()

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })

  it('closes both sides with 1011 when the upstream does not open in time', () => {
    vi.useFakeTimers()
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    bridgeWebSocket(upstream, peer, { connectTimeoutMs: 50 })

    vi.advanceTimersByTime(50)

    expect(upstream.close).toHaveBeenCalledTimes(1)
    expect(peer.closeCalls).toEqual([{ code: 1011, reason: 'Upstream connect timeout' }])
  })

  it('clears the connect deadline once the upstream opens', () => {
    vi.useFakeTimers()
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    bridgeWebSocket(upstream, peer, { connectTimeoutMs: 50 })

    upstream.open()
    vi.advanceTimersByTime(1000)

    expect(peer.closeCalls).toEqual([])
    expect(upstream.close).not.toHaveBeenCalled()
  })

  it('delivers initialMessages before later upstream messages', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    const bridge = bridgeWebSocket(upstream, peer, {
      initialMessages: ['early text', new Uint8Array([9]).buffer],
    })

    upstream.emitMessage('later')

    expect(peer.sent).toEqual(['early text', new Uint8Array([9]), 'later'])
    bridge.close()
  })

  it('applies the peer buffer cap while delivering initialMessages', () => {
    const upstream = new FakeWebSocket('ws://upstream')
    const peer = new FakePeer()
    peer.buffered = MAX_PEER_BUFFERED_BYTES + 1

    bridgeWebSocket(upstream, peer, { initialMessages: ['overflow'] })

    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Client too slow' }])
    expect(upstream.close).toHaveBeenCalledTimes(1)
  })
})

describe('connectUpstreamWebSocket', () => {
  it('resolves on open, forwards protocols and buffers messages until attach', async () => {
    const promise = connectUpstreamWebSocket('ws://upstream', { protocols: ['vite-hmr'] })
    const socket = ControllableWebSocket.last()
    expect(socket.protocols).toEqual(['vite-hmr'])
    expect(socket.binaryType).toBe('arraybuffer')

    socket.open()
    const pending = await promise

    socket.emitMessage('early')
    const peer = new FakePeer()
    const bridge = pending.attach(peer)

    expect(peer.sent).toEqual(['early'])

    socket.emitMessage(new Uint8Array([1, 2]).buffer)
    expect(peer.sent).toEqual(['early', new Uint8Array([1, 2])])

    bridge.close()
  })

  it('converts byte frames buffered before attach to ArrayBuffer', async () => {
    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableWebSocket.last()
    socket.open()
    const pending = await promise

    socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([3, 4]) }))
    const peer = new FakePeer()
    const bridge = pending.attach(peer)

    expect(peer.sent).toEqual([new Uint8Array([3, 4])])
    bridge.close()
  })

  it('rejects and closes the socket when the upstream errors before open', async () => {
    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableWebSocket.last()
    socket.emitError()

    await expect(promise).rejects.toThrow('Failed to connect')
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('rejects and closes the socket when the upstream closes before open', async () => {
    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableWebSocket.last()
    socket.emitClose(1006)

    await expect(promise).rejects.toThrow('closed before connect')
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('rejects and closes the socket when the connect times out', async () => {
    vi.useFakeTimers()
    const promise = connectUpstreamWebSocket('ws://upstream', { timeoutMs: 50 })
    const socket = ControllableWebSocket.last()
    const rejection = expect(promise).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(50)
    await rejection

    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('closes the socket when attach is not called within the timeout', async () => {
    vi.useFakeTimers()
    const promise = connectUpstreamWebSocket('ws://upstream', { timeoutMs: 50 })
    const socket = ControllableWebSocket.last()
    socket.open()
    await promise

    await vi.advanceTimersByTimeAsync(50)

    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('abandon closes the socket', async () => {
    const promise = connectUpstreamWebSocket('ws://upstream')
    const socket = ControllableWebSocket.last()
    socket.open()
    const pending = await promise

    pending.abandon()

    expect(socket.close).toHaveBeenCalledTimes(1)
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
    const bridge = new RecordingBridge()
    const events = createBridgedSocketEvents(() => Promise.resolve(bridge))
    const { ws } = createContext()

    events.onOpen?.(new Event('open'), ws)
    await events.onMessage?.(new MessageEvent('message', { data: 'hello' }), ws)

    expect(bridge.sent).toEqual(['hello'])
  })

  it('closes the client with 1011 when the bridge factory throws synchronously', async () => {
    const events = createBridgedSocketEvents(() => {
      throw new Error('boom')
    })
    const { ws, closeCalls } = createContext()

    events.onOpen?.(new Event('open'), ws)
    await flushAsync()

    expect(closeCalls).toEqual([{ code: 1011, reason: 'boom' }])
  })

  it('closes the client with 1011 when the bridge factory rejects', async () => {
    const events = createBridgedSocketEvents(() => Promise.reject(new Error('nope')))
    const { ws, closeCalls } = createContext()

    events.onOpen?.(new Event('open'), ws)
    await flushAsync()

    expect(closeCalls).toEqual([{ code: 1011, reason: 'nope' }])
  })

  it('does not close the client when it already closed', async () => {
    const events = createBridgedSocketEvents(() => {
      throw new Error('late')
    })
    const { ws, closeCalls } = createContext()

    events.onOpen?.(new Event('open'), ws)
    events.onClose?.(new CloseEvent('close'), ws)
    await flushAsync()

    expect(closeCalls).toEqual([])
  })

  it('closes a bridge that resolves after the client closed', async () => {
    let resolveBridge: (bridge: WebSocketBridge) => void = () => {}
    const events = createBridgedSocketEvents(
      () => new Promise<WebSocketBridge>((resolve) => {
        resolveBridge = resolve
      }),
    )
    const { ws } = createContext()

    events.onOpen?.(new Event('open'), ws)
    events.onClose?.(new CloseEvent('close'), ws)

    const bridge = new RecordingBridge()
    resolveBridge(bridge)
    await flushAsync()

    expect(bridge.closeCalls).toBe(1)
  })

  it('waits for the connect before forwarding messages', async () => {
    let resolveBridge: (bridge: WebSocketBridge) => void = () => {}
    const events = createBridgedSocketEvents(
      () => new Promise<WebSocketBridge>((resolve) => {
        resolveBridge = resolve
      }),
    )
    const { ws } = createContext()

    events.onOpen?.(new Event('open'), ws)
    const messagePromise = events.onMessage?.(new MessageEvent('message', { data: 'queued' }), ws)

    const bridge = new RecordingBridge()
    resolveBridge(bridge)
    await messagePromise

    expect(bridge.sent).toEqual(['queued'])
  })
})

describe('toWebSocketPeer', () => {
  it('forwards send, close and bufferedAmount to the context', () => {
    const { ws, sent, closeCalls, raw } = createContext()
    raw.bufferedAmount = 42
    const peer = toWebSocketPeer(ws)

    peer.send('data')
    peer.send(new Uint8Array([1]))
    peer.close(1000, 'done')

    expect(sent).toEqual(['data', new Uint8Array([1])])
    expect(closeCalls).toEqual([{ code: 1000, reason: 'done' }])
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
  it('forwards strings, ArrayBuffers and Blobs to the bridge', async () => {
    const bridge = new RecordingBridge()

    await forwardPeerMessage(bridge, 'plain text')
    await forwardPeerMessage(bridge, new Uint8Array([1, 2]).buffer)
    await forwardPeerMessage(bridge, new Blob(['blob body']))

    expect(bridge.sent).toEqual([
      'plain text',
      new Uint8Array([1, 2]).buffer,
      new TextEncoder().encode('blob body').buffer,
    ])
  })
})
