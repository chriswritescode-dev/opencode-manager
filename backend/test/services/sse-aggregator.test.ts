import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { sseAggregator, type PendingActionsFetcher } from '../../src/services/sse-aggregator'

interface CapturedEvent {
  event: string
  data: string
}

function createCapturingClient() {
  const events: CapturedEvent[] = []
  const frames: string[] = []
  const decoder = new TextDecoder()
  const callback = (event: string, data: string) => {
    events.push({ event, data })
  }
  const writeFrame = (frame: Uint8Array) => {
    frames.push(decoder.decode(frame))
  }
  return { callback, writeFrame, events, frames }
}

function makeFetcher(map: Record<string, { permissions?: unknown[]; questions?: unknown[] }>): PendingActionsFetcher {
  return {
    async getJson<T>(path: string, opts?: { directory?: string }): Promise<T> {
      const directory = opts?.directory ?? ''
      const entry = map[directory] ?? {}
      if (path === '/permission') return (entry.permissions ?? []) as T
      if (path === '/question') return (entry.questions ?? []) as T
      throw new Error(`unexpected path: ${path}`)
    },
  }
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('SSEAggregator pending replay on connect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
  })

  it('replays pending permissions and questions to a new client per subscribed directory', async () => {
    const fetcher = makeFetcher({
      '/repo/a': {
        permissions: [
          { id: 'perm-1', sessionID: 'sess-a' },
          { id: 'perm-2', sessionID: 'sess-a' },
        ],
        questions: [{ id: 'q-1', sessionID: 'sess-a', questions: [] }],
      },
      '/repo/b': {
        permissions: [{ id: 'perm-3', sessionID: 'sess-b' }],
        questions: [],
      },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-1', callback, writeFrame, ['/repo/a', '/repo/b'])

    await flushReplay()

    expect(events).toHaveLength(4)

    const parsed = events.map(e => JSON.parse(e.data) as { directory: string; payload: { type: string; properties: { id: string } } })

    expect(parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/a').map(p => p.payload.properties.id)).toEqual([
      'perm-1',
      'perm-2',
    ])
    expect(parsed.filter(p => p.payload.type === 'question.asked' && p.directory === '/repo/a').map(p => p.payload.properties.id)).toEqual(['q-1'])
    expect(parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/b').map(p => p.payload.properties.id)).toEqual([
      'perm-3',
    ])
    expect(parsed.filter(p => p.payload.type === 'question.asked' && p.directory === '/repo/b')).toHaveLength(0)
  })

  it('does not replay when no fetcher is configured', async () => {
    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-2', callback, writeFrame, ['/repo/a'])

    await flushReplay()

    expect(events).toHaveLength(0)
  })

  it('does not replay to other clients', async () => {
    const fetcher = makeFetcher({
      '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 'sess-a' }] },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    sseAggregator.addClient('a', clientA.callback, clientA.writeFrame, ['/repo/a'])
    sseAggregator.addClient('b', clientB.callback, clientB.writeFrame, [])

    await flushReplay()

    expect(clientA.events).toHaveLength(1)
    expect(clientB.events).toHaveLength(0)
  })

  it('replays only newly added directories on addDirectories', async () => {
    const fetcher = makeFetcher({
      '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 'sess-a' }] },
      '/repo/b': { permissions: [{ id: 'perm-2', sessionID: 'sess-b' }] },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-3', callback, writeFrame, ['/repo/a'])
    await flushReplay()

    const initialCount = events.length
    expect(initialCount).toBe(1)

    sseAggregator.addDirectories('client-3', ['/repo/a', '/repo/b'])
    await flushReplay()

    const newEvents = events.slice(initialCount)
    const parsed = newEvents.map(e => JSON.parse(e.data) as { directory: string; payload: { type: string; properties: { id: string } } })
    expect(parsed).toHaveLength(1)
    const [first] = parsed
    expect(first?.directory).toBe('/repo/b')
    expect(first?.payload.properties.id).toBe('perm-2')
  })

  it('survives upstream fetch failures for one directory and still replays the others', async () => {
    const fetcher: PendingActionsFetcher = {
      async getJson<T>(path: string, opts?: { directory?: string }): Promise<T> {
        if (opts?.directory === '/repo/broken') {
          throw new Error('upstream down')
        }
        if (path === '/permission' && opts?.directory === '/repo/ok') {
          return [{ id: 'perm-ok', sessionID: 's' }] as unknown as T
        }
        return [] as unknown as T
      },
    }
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-4', callback, writeFrame, ['/repo/broken', '/repo/ok'])
    await flushReplay()

    const parsed = events.map(e => JSON.parse(e.data) as { directory: string; payload: { properties: { id: string } } })
    expect(parsed).toHaveLength(1)
    const [first] = parsed
    expect(first?.directory).toBe('/repo/ok')
    expect(first?.payload.properties.id).toBe('perm-ok')
  })

  it('does not deliver replay events to a client that no longer subscribes to that directory', async () => {
    let resolvePermissions: (val: unknown[]) => void = () => {}
    const fetcher: PendingActionsFetcher = {
      async getJson<T>(path: string): Promise<T> {
        if (path === '/permission') {
          return new Promise<T>((resolve) => {
            resolvePermissions = resolve as (val: unknown[]) => void
          })
        }
        return [] as unknown as T
      },
    }
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-5', callback, writeFrame, ['/repo/a'])

    sseAggregator.removeDirectories('client-5', ['/repo/a'])
    resolvePermissions([{ id: 'late', sessionID: 's' }])

    await flushReplay()

    expect(events).toHaveLength(0)
  })
})

describe('SSEAggregator directory-indexed broadcast', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  it('delivers only to clients subscribed to the event directory', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('index-a', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-b', clientB.callback, clientB.writeFrame, ['/b'])

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
  })

  it('does not encode a frame when no client subscribes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-c', clientA.callback, clientA.writeFrame, ['/a'])

    const data = JSON.stringify({ directory: '/z', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(0)
  })

  it('removeClient deindexes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-d', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.removeClient('index-d')

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(0)
  })

  it('addDirectories then delivery', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-e', clientA.callback, clientA.writeFrame, [])
    sseAggregator.addDirectories('index-e', ['/a'])

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(1)
  })

  it('replacing a client ID deindexes old directories', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    // Add client with id 'index-f' subscribed to /a
    sseAggregator.addClient('index-f', clientA.callback, clientA.writeFrame, ['/a'])

    // Replace same client ID with different directories (no /a)
    sseAggregator.addClient('index-f', clientB.callback, clientB.writeFrame, ['/b'])

    // Message for /a should NOT reach either client
    const dataA = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(dataA)

    expect(clientA.frames).toHaveLength(0)
    expect(clientB.frames).toHaveLength(0)

    // Message for /b should reach clientB
    const dataB = JSON.stringify({ directory: '/b', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(dataB)

    expect(clientB.frames).toHaveLength(1)
  })
})
