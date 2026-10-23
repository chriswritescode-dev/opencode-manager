import { describe, expect, it, vi } from 'vitest'
import { TerminalHub } from '../../src/services/terminal-hub'
import type { WebSocketPeer } from '../../src/utils/websocket-bridge'

class FakeSocket {
  binaryType: 'blob' | 'arraybuffer' = 'blob'
  readyState = 0
  readonly sent: Array<string | Uint8Array> = []
  close = vi.fn()
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: unknown) => void>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

interface FakePeer extends WebSocketPeer {
  sent: Array<string | Uint8Array>
  closeCalls: Array<{ code?: number; reason?: string }>
}

function createPeer(): FakePeer {
  const sent: Array<string | Uint8Array> = []
  const closeCalls: Array<{ code?: number; reason?: string }> = []
  return {
    sent,
    closeCalls,
    send(data) {
      sent.push(data)
    },
    close(code, reason) {
      closeCalls.push({ code, reason })
    },
    bufferedAmount() {
      return 0
    },
  }
}

function decodeMeta(data: string | Uint8Array): number {
  expect(data).toBeInstanceOf(Uint8Array)
  const bytes = data as Uint8Array
  expect(bytes[0]).toBe(0)
  return (JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as { cursor: number }).cursor
}

async function createOpenHub(): Promise<{ hub: TerminalHub; socket: FakeSocket }> {
  const socket = new FakeSocket()
  const hub = new TerminalHub({ openUpstream: async () => socket as unknown as WebSocket })
  await hub.start()
  socket.readyState = 1
  socket.emit('open')
  return { hub, socket }
}

describe('TerminalHub', () => {
  it('sends retained output, then the cursor, then live output to a late client', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emit('message', { data: 'hi\r\n' })

    const peer = createPeer()
    hub.attach(peer, undefined)
    socket.emit('message', { data: 'more' })

    expect(peer.sent[0]).toBe('hi\r\n')
    expect(decodeMeta(peer.sent[1]!)).toBe(4)
    expect(peer.sent[2]).toBe('more')
    expect(peer.closeCalls).toEqual([])
  })

  it('replays an exited terminal and then closes the client', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emit('message', { data: 'hi' })
    socket.emit('close', { code: 1000 })

    const peer = createPeer()
    hub.attach(peer, undefined)

    expect(peer.sent[0]).toBe('hi')
    expect(decodeMeta(peer.sent[1]!)).toBe(2)
    expect(peer.closeCalls).toEqual([{ code: 1000, reason: undefined }])
    expect(hub.isEnded()).toBe(true)
  })

  it('replays only the output after the cursor a reconnecting client sends back', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emit('message', { data: 'first' })
    socket.emit('message', { data: 'second' })

    const client = createPeer()
    hub.attach(client, undefined)
    expect(client.sent[1]).toBeInstanceOf(Uint8Array)
    hub.attach(client, decodeMeta(client.sent[1]!))

    const reconnected = createPeer()
    hub.attach(reconnected, 5)

    expect(reconnected.sent[0]).toBe('second')
    expect(decodeMeta(reconnected.sent[1]!)).toBe(11)
  })

  it('tails an exited terminal without replaying its buffer for cursor -1', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emit('message', { data: 'hello' })
    socket.emit('close', {})

    const peer = createPeer()
    hub.attach(peer, -1)

    expect(peer.sent).toHaveLength(1)
    expect(decodeMeta(peer.sent[0]!)).toBe(5)
    expect(peer.closeCalls).toEqual([{ code: 1000, reason: undefined }])
  })

  it('keeps the retained buffer bounded while the cursor keeps counting', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emit('message', { data: 'a'.repeat(300 * 1024) })

    const peer = createPeer()
    hub.attach(peer, undefined)

    const replay = peer.sent
      .slice(0, -1)
      .map((chunk) => chunk as string)
      .join('')
    expect(replay).toHaveLength(256 * 1024)
    expect(decodeMeta(peer.sent[peer.sent.length - 1]!)).toBe(300 * 1024)
  })

  it('queues client input until the upstream opens and then forwards it', async () => {
    const socket = new FakeSocket()
    const hub = new TerminalHub({ openUpstream: async () => socket as unknown as WebSocket })
    await hub.start()

    const peer = createPeer()
    const bridge = hub.attach(peer, undefined)
    bridge.send('typed')
    expect(socket.sent).toEqual([])

    socket.readyState = 1
    socket.emit('open')
    bridge.send('later')

    expect(socket.sent).toEqual(['typed', 'later'])
  })

  it('stops delivering live output once a client detaches', async () => {
    const { hub, socket } = await createOpenHub()
    const peer = createPeer()
    const bridge = hub.attach(peer, undefined)
    bridge.close()

    socket.emit('message', { data: 'after close' })

    expect(peer.sent.some((chunk) => chunk === 'after close')).toBe(false)
  })
})
