import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TerminalHub } from '../../src/services/terminal-hub'
import { MAX_UPSTREAM_BUFFERED_BYTES, UPSTREAM_CONNECT_TIMEOUT_MS } from '../../src/utils/websocket-bridge'
import { FakePeer, FakeWebSocket } from '../helpers/fake-websocket'

const RETRY_DELAY_MS = 100

const MetaFrameSchema = z.object({ cursor: z.number() })

function decodeMeta(chunk: string | Uint8Array<ArrayBuffer> | undefined): number {
  if (!(chunk instanceof Uint8Array)) {
    throw new Error('Expected a binary terminal meta frame')
  }
  expect(chunk[0]).toBe(0)
  return MetaFrameSchema.parse(JSON.parse(new TextDecoder().decode(chunk.subarray(1)))).cursor
}

function textFrame(chunk: string | Uint8Array<ArrayBuffer>): string {
  if (chunk instanceof Uint8Array) {
    throw new Error('Expected a text frame')
  }
  return chunk
}

async function createOpenHub(): Promise<{ hub: TerminalHub; socket: FakeWebSocket }> {
  const socket = new FakeWebSocket('ws://upstream')
  const hub = new TerminalHub({ openUpstream: async () => socket })
  await hub.start()
  socket.open()
  return { hub, socket }
}

describe('TerminalHub', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends retained output, then the cursor, then live output to a late client', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('hi\r\n')

    const peer = new FakePeer()
    hub.attach(peer, undefined)
    socket.emitMessage('more')

    expect(peer.sent[0]).toBe('hi\r\n')
    expect(decodeMeta(peer.sent[1])).toBe(4)
    expect(peer.sent[2]).toBe('more')
    expect(peer.closeCalls).toEqual([])
  })

  it('replays an exited terminal and then closes the client', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('hi')
    socket.emitClose(1000)

    const peer = new FakePeer()
    hub.attach(peer, undefined)

    expect(peer.sent[0]).toBe('hi')
    expect(decodeMeta(peer.sent[1])).toBe(2)
    expect(peer.closeCalls).toEqual([{ code: 1000, reason: undefined }])
    expect(hub.isEnded()).toBe(true)
  })

  it('replays only the output after the cursor a reconnecting client sends back', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('first')
    socket.emitMessage('second')

    const client = new FakePeer()
    hub.attach(client, undefined)
    expect(client.sent[1]).toBeInstanceOf(Uint8Array)
    hub.attach(client, decodeMeta(client.sent[1]))

    const reconnected = new FakePeer()
    hub.attach(reconnected, 5)

    expect(reconnected.sent[0]).toBe('second')
    expect(decodeMeta(reconnected.sent[1])).toBe(11)
  })

  it('tails an exited terminal without replaying its buffer for cursor -1', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('hello')
    socket.emitClose(1000)

    const peer = new FakePeer()
    hub.attach(peer, -1)

    expect(peer.sent).toHaveLength(1)
    expect(decodeMeta(peer.sent[0])).toBe(5)
    expect(peer.closeCalls).toEqual([{ code: 1000, reason: undefined }])
  })

  it('keeps the retained buffer bounded while the cursor keeps counting', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('a'.repeat(300 * 1024))

    const peer = new FakePeer()
    hub.attach(peer, undefined)

    expect(peer.sent.slice(0, -1).map(textFrame).join('')).toHaveLength(256 * 1024)
    expect(decodeMeta(peer.sent[peer.sent.length - 1])).toBe(300 * 1024)
  })

  it('queues client input until the upstream opens and then forwards it', async () => {
    const socket = new FakeWebSocket('ws://upstream')
    const hub = new TerminalHub({ openUpstream: async () => socket })
    await hub.start()

    const peer = new FakePeer()
    const bridge = hub.attach(peer, undefined)
    bridge.send('typed')
    expect(socket.sent).toEqual([])

    socket.open()
    bridge.send('later')

    expect(socket.sent).toEqual(['typed', 'later'])
  })

  it('stops delivering live output once a client detaches', async () => {
    const { hub, socket } = await createOpenHub()
    const peer = new FakePeer()
    const bridge = hub.attach(peer, undefined)
    bridge.close()

    socket.emitMessage('after close')

    expect(peer.sent.some((chunk) => chunk === 'after close')).toBe(false)
  })

  it.each([1000, 4404])('closes attached clients with the upstream exit code %i', async (code) => {
    const { hub, socket } = await createOpenHub()
    const peer = new FakePeer()
    hub.attach(peer, undefined)

    socket.emitClose(code)

    expect(peer.closeCalls).toEqual([{ code, reason: undefined }])
    expect(hub.isAvailable()).toBe(true)
    expect(hub.isEnded()).toBe(true)
  })

  it('replays and closes a late client with a 4404 exit code', async () => {
    const { hub, socket } = await createOpenHub()
    socket.emitMessage('gone')
    socket.emitClose(4404)

    const peer = new FakePeer()
    hub.attach(peer, undefined)

    expect(peer.sent[0]).toBe('gone')
    expect(peer.closeCalls).toEqual([{ code: 4404, reason: undefined }])
  })

  it('fails the hub on an abnormal upstream close so the client can fall back', async () => {
    const { hub, socket } = await createOpenHub()
    const peer = new FakePeer()
    hub.attach(peer, undefined)

    socket.emitClose(1006)

    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])
    expect(hub.isAvailable()).toBe(false)
    expect(hub.isEnded()).toBe(true)

    const late = new FakePeer()
    hub.attach(late, undefined)
    expect(late.closeCalls).toEqual([{ code: 1011, reason: undefined }])
  })

  it('retries each connect attempt after the upstream timeout and then fails', async () => {
    vi.useFakeTimers()
    const sockets: FakeWebSocket[] = []
    const hub = new TerminalHub({
      openUpstream: async () => {
        const socket = new FakeWebSocket('ws://upstream')
        sockets.push(socket)
        return socket
      },
    })
    await hub.start()
    expect(sockets).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(UPSTREAM_CONNECT_TIMEOUT_MS)
    expect(sockets[0]!.close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    expect(sockets).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(UPSTREAM_CONNECT_TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    expect(sockets).toHaveLength(3)

    const peer = new FakePeer()
    hub.attach(peer, undefined)
    await vi.advanceTimersByTimeAsync(UPSTREAM_CONNECT_TIMEOUT_MS)

    expect(hub.isAvailable()).toBe(false)
    expect(peer.closeCalls).toEqual([{ code: 1011, reason: undefined }])
    expect(sockets).toHaveLength(3)
  })

  it('fails the hub and closes clients 1013 when queued input exceeds the upstream limit', async () => {
    const socket = new FakeWebSocket('ws://upstream')
    const hub = new TerminalHub({ openUpstream: async () => socket })
    await hub.start()

    const peer = new FakePeer()
    const bridge = hub.attach(peer, undefined)
    bridge.send('x'.repeat(MAX_UPSTREAM_BUFFERED_BYTES + 1))

    expect(hub.isAvailable()).toBe(false)
    expect(peer.closeCalls).toEqual([{ code: 1013, reason: 'Upstream too slow' }])
    expect(socket.sent).toEqual([])
  })

  it('releases a deferred command once before queued client input', async () => {
    const socket = new FakeWebSocket('ws://upstream')
    const hub = new TerminalHub({ openUpstream: async () => socket, releaseOnOpen: '\n' })
    await hub.start()

    const peer = new FakePeer()
    const bridge = hub.attach(peer, undefined)
    bridge.send('typed')
    expect(socket.sent).toEqual([])

    socket.open()
    socket.open()

    expect(socket.sent).toEqual(['\n', 'typed'])
    expect(hub.hasReleased()).toBe(true)
  })
})
