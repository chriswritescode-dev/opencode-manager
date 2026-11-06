import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import type { OpenCodeApi, V2Event } from '@opencode-manager/shared/opencode'
import type { OpenCodeServer, OpenCodeServerTestResult } from '@opencode-manager/shared/schemas'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { RemoteServerEventHub } from '../../src/services/remote-server-events'
import type {
  OpenCodeServerChange,
  OpenCodeServerConnection,
  OpenCodeServerRegistry,
} from '../../src/services/opencode-server-registry'

const SERVER_A: OpenCodeServer = {
  id: 'srv_a',
  name: 'Studio',
  baseUrl: 'https://studio.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 1,
}

const SERVER_B: OpenCodeServer = {
  id: 'srv_b',
  name: 'Laptop',
  baseUrl: 'https://laptop.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: false,
  createdAt: 1,
  updatedAt: 1,
}

const SERVER_CONNECTED: V2Event = { id: 'evt_connected', type: 'server.connected', data: {} }

interface ControlledEventStream {
  iterable: AsyncIterable<V2Event>
  signal: AbortSignal
  push: (event: V2Event) => void
  end: () => void
  fail: (error: unknown) => void
}

function createControlledEventStream(): ControlledEventStream {
  const queue: V2Event[] = []
  let finished = false
  let failure: { value: unknown } | null = null
  let signal: AbortSignal
  let notify: (() => void) | null = null

  const wake = (): void => {
    const current = notify
    notify = null
    current?.()
  }

  const iterable: AsyncIterable<V2Event> = {
    [Symbol.asyncIterator]: () => ({
      async next() {
        for (;;) {
          if (queue.length > 0) return { value: queue.shift()!, done: false }
          if (failure) {
            const current = failure.value
            failure = null
            throw current
          }
          if (finished) return { value: undefined, done: true }
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }
      },
    }),
  }

  return {
    iterable,
    get signal() {
      return signal
    },
    set signal(next: AbortSignal) {
      signal = next
      next.addEventListener('abort', () => {
        failure = { value: next.reason ?? new Error('aborted') }
        wake()
      }, { once: true })
    },
    push: (event) => {
      queue.push(event)
      wake()
    },
    end: () => {
      finished = true
      wake()
    },
    fail: (error) => {
      failure = { value: error }
      wake()
    },
  } as ControlledEventStream
}

interface CapturedClient {
  events: Array<{ event: string; data: string }>
  frames: string[]
  callback: (event: string, data: string) => void
  writeFrame: (frame: Uint8Array) => void
}

function createCapturingClient(): CapturedClient {
  const events: Array<{ event: string; data: string }> = []
  const frames: string[] = []
  const decoder = new TextDecoder()
  return {
    events,
    frames,
    callback: (event, data) => { events.push({ event, data }) },
    writeFrame: (frame) => { frames.push(decoder.decode(frame)) },
  }
}

function parseFrame(frame: string): {
  directory: string | null
  serverId?: string
  payload: { id?: string; type: string; data: Record<string, unknown> }
} {
  return JSON.parse(frame.replace(/^event: message\ndata: /, '').trim())
}

interface ApiFixture {
  permissions?: Record<string, unknown[]>
  forms?: Record<string, unknown[]>
  active?: Record<string, { type: 'running' }>
  sessionDirectories?: Record<string, string>
}

function makeApi(fixture: ApiFixture, subscriptions: ControlledEventStream[]): OpenCodeApi {
  const directoryOf = (input?: { location?: { directory?: string } }): string => input?.location?.directory ?? ''

  return {
    event: {
      subscribe: (options: { signal?: AbortSignal; onActivity?: () => void }) => {
        const stream = createControlledEventStream()
        stream.signal = options.signal!
        subscriptions.push(stream)
        return stream.iterable
      },
    },
    permission: {
      request: {
        list: vi.fn(async (input?: { location?: { directory?: string } }) => ({
          location: { directory: directoryOf(input) },
          data: fixture.permissions?.[directoryOf(input)] ?? [],
        })),
      },
    },
    form: {
      list: vi.fn(async (input?: { location?: { directory?: string } }) => ({
        location: { directory: directoryOf(input) },
        data: fixture.forms?.[directoryOf(input)] ?? [],
      })),
    },
    session: {
      active: vi.fn(async () => fixture.active ?? {}),
      get: vi.fn(async (input: { sessionID: string }) => ({
        location: { directory: fixture.sessionDirectories?.[input.sessionID] ?? '' },
      })),
    },
  } as unknown as OpenCodeApi
}

interface FakeServerTransport {
  api: OpenCodeApi
  subscriptions: ControlledEventStream[]
}

interface FakeRegistry {
  registry: OpenCodeServerRegistry
  api: OpenCodeApi
  transport: (serverId: string) => FakeServerTransport
  latest: (serverId: string) => ControlledEventStream
  emit: (change: OpenCodeServerChange) => void
  setServer: (server: OpenCodeServer) => void
  removeServer: (serverId: string) => void
  listCalls: () => number
  clientCalls: string[]
}

function createRegistry(servers: OpenCodeServer[], fixture: ApiFixture = {}): FakeRegistry {
  const byId = new Map(servers.map(server => [server.id, server]))
  const listeners = new Set<(change: OpenCodeServerChange) => void>()
  const transports = new Map<string, FakeServerTransport>()
  const clientCalls: string[] = []
  let listCalls = 0

  const transport = (serverId: string): FakeServerTransport => {
    const existing = transports.get(serverId)
    if (existing) return existing

    const subscriptions: ControlledEventStream[] = []
    const created: FakeServerTransport = { api: makeApi(fixture, subscriptions), subscriptions }
    transports.set(serverId, created)
    return created
  }

  const registry = {
    list: () => {
      listCalls += 1
      return Array.from(byId.values())
    },
    get: (serverId: string) => byId.get(serverId) ?? null,
    getConnection: (serverId: string): OpenCodeServerConnection => {
      const server = byId.get(serverId)
      if (!server) throw new Error(`OpenCode server not found: ${serverId}`)
      if (!server.enabled) throw new Error(`OpenCode server is disabled: ${serverId}`)
      return {
        baseUrl: server.baseUrl,
        authorization: server.hasPassword ? 'Basic dXNlcjpwYXNz' : null,
      }
    },
    getClient: (serverId: string) => {
      clientCalls.push(serverId)
      return { api: transport(serverId).api }
    },
    onChange: (listener: (change: OpenCodeServerChange) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    test: vi.fn(async () => ({ ok: true, version: '2.0.15', versionSupported: true, error: null })),
  } as unknown as OpenCodeServerRegistry

  return {
    registry,
    api: transport(servers[0]!.id).api,
    transport,
    latest: (serverId) => {
      const subscriptions = transport(serverId).subscriptions
      const latest = subscriptions[subscriptions.length - 1]
      if (!latest) throw new Error(`No subscription for ${serverId}`)
      return latest
    },
    emit: (change) => { listeners.forEach(listener => listener(change)) },
    setServer: (server) => { byId.set(server.id, server) },
    removeServer: (serverId) => { byId.delete(serverId) },
    listCalls: () => listCalls,
    clientCalls,
  }
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

function remoteEvent(type: string, data: unknown, directory?: string): V2Event {
  return {
    id: 'evt_1',
    created: 1,
    type,
    ...(directory ? { location: { directory } } : {}),
    data,
  } as V2Event
}

describe('RemoteServerEventHub event delivery', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A, SERVER_B])
    hub = new RemoteServerEventHub(fake.registry, sseAggregator)
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
  })

  it('opens one subscription per enabled server through the registry client', () => {
    hub.start()

    expect(fake.clientCalls).toEqual(['srv_a', 'srv_b'])
    expect(fake.transport('srv_a').subscriptions).toHaveLength(1)
    expect(fake.transport('srv_b').subscriptions).toHaveLength(1)
  })

  it('broadcasts a located event to every client with a serverId envelope', async () => {
    const remoteClient = createCapturingClient()
    const otherServerClient = createCapturingClient()
    const localClient = createCapturingClient()
    sseAggregator.addClient('remote-a', remoteClient.callback, remoteClient.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('remote-b', otherServerClient.callback, otherServerClient.writeFrame, ['srv_b|/repo'])
    sseAggregator.addClient('local-a', localClient.callback, localClient.writeFrame, ['/repo'])

    const listener = vi.fn()
    sseAggregator.onEvent(listener)

    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(SERVER_CONNECTED)
    await flushPromises()
    remoteClient.frames.length = 0
    otherServerClient.frames.length = 0
    localClient.frames.length = 0

    stream.push(remoteEvent('session.idle', { sessionID: 'ses_1' }, '/repo'))
    await flushPromises()

    const envelope = {
      directory: '/repo',
      serverId: 'srv_a',
      payload: {
        id: 'evt_1',
        created: 1,
        type: 'session.idle',
        location: { directory: '/repo' },
        data: { sessionID: 'ses_1' },
      },
    }
    expect(remoteClient.frames.map(parseFrame)).toEqual([envelope])
    expect(otherServerClient.frames.map(parseFrame)).toEqual([envelope])
    expect(localClient.frames.map(parseFrame)).toEqual([envelope])
    expect(listener).not.toHaveBeenCalled()
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('resolves a directory-less event through the per-server session map', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('session-map', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(remoteEvent('session.created', { sessionID: 'ses_1', parentID: null }, '/repo'))
    await flushPromises()
    client.frames.length = 0

    stream.push(remoteEvent('session.execution.succeeded', { sessionID: 'ses_1' }))
    await flushPromises()

    expect(client.frames.map(parseFrame)).toEqual([{
      directory: '/repo',
      serverId: 'srv_a',
      payload: {
        id: 'evt_1',
        created: 1,
        type: 'session.execution.succeeded',
        data: { sessionID: 'ses_1' },
      },
    }])
  })

  it('inherits the parent directory for a forked session and forgets deleted sessions', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('fork', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(remoteEvent('session.created', { sessionID: 'ses_parent' }, '/repo'))
    stream.push(remoteEvent('session.forked', { sessionID: 'ses_fork', parentID: 'ses_parent' }))
    await flushPromises()
    client.frames.length = 0

    stream.push(remoteEvent('session.execution.succeeded', { sessionID: 'ses_fork' }))
    await flushPromises()
    expect(client.frames.map(parseFrame).map(frame => frame.directory)).toEqual(['/repo'])

    stream.push(remoteEvent('session.deleted', { sessionID: 'ses_fork' }))
    await flushPromises()
    client.frames.length = 0
    stream.push(remoteEvent('session.execution.succeeded', { sessionID: 'ses_fork' }))
    await flushPromises()

    expect(client.frames.map(parseFrame)).toEqual([{
      directory: null,
      serverId: 'srv_a',
      payload: {
        id: 'evt_1',
        created: 1,
        type: 'session.execution.succeeded',
        data: { sessionID: 'ses_fork' },
      },
    }])
  })

  it('broadcasts to every client when the directory is unknown', async () => {
    const subscribedA = createCapturingClient()
    const otherDirectoryA = createCapturingClient()
    const subscribedB = createCapturingClient()
    sseAggregator.addClient('any-a', subscribedA.callback, subscribedA.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('other-a', otherDirectoryA.callback, otherDirectoryA.writeFrame, ['srv_a|/elsewhere'])
    sseAggregator.addClient('any-b', subscribedB.callback, subscribedB.writeFrame, ['srv_b|/repo'])

    hub.start()
    fake.latest('srv_a').push(remoteEvent('server.connected', {}))
    await flushPromises()

    const envelope = {
      directory: null,
      serverId: 'srv_a',
      payload: { id: 'evt_1', created: 1, type: 'server.connected', data: {} },
    }
    expect(subscribedA.frames.map(parseFrame)).toEqual([envelope])
    expect(otherDirectoryA.frames.map(parseFrame)).toEqual([envelope])
    expect(subscribedB.frames.map(parseFrame)).toEqual([envelope])
  })

  it('serializes the routed event into a single envelope data line', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('raw-remote', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const event = remoteEvent('session.idle', { sessionID: 'ses_1', extra: { b: 2, a: 1 } }, '/repo')
    fake.latest('srv_a').push(event)
    await flushPromises()

    expect(client.frames).toHaveLength(1)
    expect(client.frames[0]!.split('\n').filter(line => line.startsWith('data: '))).toHaveLength(1)
    expect(parseFrame(client.frames[0]!).payload).toEqual(event)
  })

  it('notifies server event listeners with the remote server id and resolved directory', async () => {
    const seen: Array<{ serverId: string; directory: string | null; type: string }> = []
    sseAggregator.onServerEvent((serverId, directory, event) => {
      seen.push({ serverId, directory, type: event.type })
    })

    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(remoteEvent('session.created', { sessionID: 'ses_1' }, '/repo'))
    stream.push(remoteEvent('session.execution.succeeded', { sessionID: 'ses_1' }))
    await flushPromises()

    expect(seen).toEqual([
      { serverId: 'srv_a', directory: '/repo', type: 'session.created' },
      { serverId: 'srv_a', directory: '/repo', type: 'session.execution.succeeded' },
    ])
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('tracks remote subagent sessions per server', async () => {
    hub.start()
    const stream = fake.latest('srv_a')

    stream.push(remoteEvent('session.created', { sessionID: 'ses_sub', parentID: 'ses_root' }, '/repo'))
    await flushPromises()

    expect(hub.isSubagentSession('srv_a', 'ses_sub')).toBe(true)
    expect(sseAggregator.isSubagentSession('ses_sub', 'srv_a')).toBe(true)
    expect(sseAggregator.isSubagentSession('ses_sub')).toBe(false)
    expect(sseAggregator.isSubagentSession('ses_sub', 'srv_b')).toBe(false)

    stream.push(remoteEvent('session.deleted', { sessionID: 'ses_sub' }))
    await flushPromises()

    expect(hub.isSubagentSession('srv_a', 'ses_sub')).toBe(false)
    expect(sseAggregator.isSubagentSession('ses_sub', 'srv_a')).toBe(false)
  })

  it('notifies server connected listeners when a remote stream opens', async () => {
    const seen: string[] = []
    sseAggregator.onServerConnected(serverId => { seen.push(serverId) })

    hub.start()
    fake.latest('srv_b').push(SERVER_CONNECTED)
    await flushPromises()

    expect(seen).toEqual(['srv_b'])
  })
})

describe('RemoteServerEventHub reconnection', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A])
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, {
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 4000,
    })
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
    vi.useRealTimers()
  })

  async function openThenReconnect(): Promise<void> {
    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()
    fake.latest('srv_a').fail(new Error('connection lost'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()
  }

  it('sends a resync to the subscribers of the server on connect', async () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('resync-a', clientA.callback, clientA.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('resync-b', clientB.callback, clientB.writeFrame, ['srv_b|/repo'])

    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    const resyncs = clientA.events.filter(event => event.event === 'resync')
    expect(resyncs).toHaveLength(1)
    expect(JSON.parse(resyncs[0]!.data)).toEqual({ timestamp: expect.any(Number), serverId: 'srv_a' })
    expect(clientB.events.filter(event => event.event === 'resync')).toHaveLength(0)
  })

  it('reconnects with exponential backoff after a stream error', async () => {
    vi.useFakeTimers()
    hub.start()
    const first = fake.latest('srv_a')
    first.push(SERVER_CONNECTED)
    await flushPromises()
    first.fail({ message: 'Unauthorized', code: 401 })
    await flushPromises()

    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: '2.0.15', error: 'Unauthorized' },
    ])

    await vi.advanceTimersByTimeAsync(999)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(2)

    const second = fake.latest('srv_a')
    second.fail({ message: 'Unauthorized', code: 401 })
    await flushPromises()

    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(3)
  })

  it('reconnects after the stream errors and after it ends', async () => {
    vi.useFakeTimers()
    hub.start()
    const first = fake.latest('srv_a')
    first.push(SERVER_CONNECTED)
    await flushPromises()

    first.end()
    await flushPromises()
    expect(hub.getStatuses()[0]?.connected).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(2)

    const second = fake.latest('srv_a')
    second.push(SERVER_CONNECTED)
    await flushPromises()
    expect(hub.getStatuses()[0]?.connected).toBe(true)

    second.fail(new Error('connection reset'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)

    expect(fake.transport('srv_a').subscriptions).toHaveLength(3)
    expect(hub.getStatuses()[0]?.error).toBe('connection reset')
  })

  it('reports the version lazily from the registry without polling', async () => {
    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(SERVER_CONNECTED)
    await flushPromises()
    stream.push(SERVER_CONNECTED)
    await flushPromises()

    expect(fake.registry.test).toHaveBeenCalledTimes(1)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: '2.0.15', error: null },
    ])
  })

  it('probes the version again after a rejected probe', async () => {
    vi.useFakeTimers()
    vi.mocked(fake.registry.test)
      .mockRejectedValueOnce(new Error('no info endpoint'))
      .mockResolvedValueOnce({ ok: true, version: '2.0.15', versionSupported: true, error: null })

    await openThenReconnect()

    expect(fake.registry.test).toHaveBeenCalledTimes(2)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: '2.0.15', error: null },
    ])
  })

  it('probes the version again after a probe without a version', async () => {
    vi.useFakeTimers()
    vi.mocked(fake.registry.test)
      .mockResolvedValueOnce({ ok: false, version: null, versionSupported: false, error: 'unreachable' })
      .mockResolvedValueOnce({ ok: true, version: '2.0.15', versionSupported: true, error: null })

    await openThenReconnect()

    expect(fake.registry.test).toHaveBeenCalledTimes(2)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: '2.0.15', error: null },
    ])
  })

  it('clears the version and probes again when the server is updated', async () => {
    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()
    expect(hub.getStatuses()[0]?.version).toBe('2.0.15')

    vi.mocked(fake.registry.test).mockResolvedValueOnce({ ok: true, version: '2.1.0', versionSupported: true, error: null })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(hub.getStatuses()[0]?.version).toBeNull()

    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    expect(fake.registry.test).toHaveBeenCalledTimes(2)
    expect(hub.getStatuses()[0]?.version).toBe('2.1.0')
  })

  it('ignores a probe that started before the server was updated', async () => {
    let resolveFirstProbe: (result: OpenCodeServerTestResult) => void = () => {}
    vi.mocked(fake.registry.test).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstProbe = resolve
    }))

    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()
    expect(fake.registry.test).toHaveBeenCalledTimes(1)

    vi.mocked(fake.registry.test).mockResolvedValueOnce({ ok: true, version: '2.1.0', versionSupported: true, error: null })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    resolveFirstProbe({ ok: true, version: '1.0.0', versionSupported: true, error: null })
    await flushPromises()

    expect(fake.registry.test).toHaveBeenCalledTimes(2)
    expect(hub.getStatuses()[0]?.version).toBe('2.1.0')
  })

  it('closes and forgets the stream when the server is disabled', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('disable', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(SERVER_CONNECTED)
    await flushPromises()
    client.frames.length = 0

    fake.setServer({ ...SERVER_A, enabled: false })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(stream.signal.aborted).toBe(true)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: null, error: null },
    ])

    stream.push(remoteEvent('session.idle', { sessionID: 'ses_1' }, '/repo'))
    await flushPromises()
    expect(client.frames).toHaveLength(0)
  })

  it('reconnects with a fresh client when the server is updated', () => {
    hub.start()
    const first = fake.latest('srv_a')

    fake.setServer({ ...SERVER_A, baseUrl: 'https://moved.example.com' })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(first.signal.aborted).toBe(true)
    expect(fake.transport('srv_a').subscriptions).toHaveLength(2)
    expect(fake.clientCalls).toEqual(['srv_a', 'srv_a'])
  })

  it('closes the stream when the server is deleted', () => {
    hub.start()
    const stream = fake.latest('srv_a')

    fake.removeServer('srv_a')
    fake.emit({ type: 'deleted', serverId: 'srv_a' })

    expect(stream.signal.aborted).toBe(true)
    expect(hub.getStatuses()).toEqual([])
  })

  it('stops reconnecting and clears the replay hook after shutdown', async () => {
    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(SERVER_CONNECTED)
    await flushPromises()
    hub.shutdown()

    expect(stream.signal.aborted).toBe(true)

    const client = createCapturingClient()
    sseAggregator.addClient('after-shutdown', client.callback, client.writeFrame, ['srv_a|/repo'])
    expect(fake.api.permission.request.list).not.toHaveBeenCalled()
  })
})

describe('RemoteServerEventHub failure handling', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A])
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, {
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 4000,
    })
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
    vi.useRealTimers()
  })

  it('reports a credential-free error for every stream failure shape', async () => {
    vi.useFakeTimers()
    hub.start()

    fake.latest('srv_a').fail(new Error('boom'))
    await flushPromises()
    expect(hub.getStatuses()[0]?.error).toBe('boom')

    await vi.advanceTimersByTimeAsync(1000)
    fake.latest('srv_a').fail('plain failure')
    await flushPromises()
    expect(hub.getStatuses()[0]?.error).toBe('plain failure')

    await vi.advanceTimersByTimeAsync(2000)
    fake.latest('srv_a').fail({ code: 500 })
    await flushPromises()
    expect(hub.getStatuses()[0]?.error).toBe('event stream closed (code=500)')

    await vi.advanceTimersByTimeAsync(4000)
    fake.latest('srv_a').fail({})
    await flushPromises()
    expect(hub.getStatuses()[0]?.error).toBe('event stream disconnected')
    expect(hub.getStatuses()[0]?.error).not.toContain('Basic')
    expect(hub.getStatuses()[0]?.error).not.toContain('studio.example.com')
  })

  it('records a connection failure without credentials and without subscribing', () => {
    ;(fake.registry as unknown as { getConnection: (serverId: string) => never }).getConnection = () => {
      throw new Error('OpenCode server is disabled: srv_a')
    }

    hub.start()

    expect(fake.transport('srv_a').subscriptions).toHaveLength(0)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: null, error: 'OpenCode server is disabled: srv_a' },
    ])
  })

  it('retries with backoff when the client cannot be created', async () => {
    vi.useFakeTimers()
    let attempts = 0
    ;(fake.registry as unknown as { getClient: (serverId: string) => never }).getClient = () => {
      attempts += 1
      throw new Error('bad event source')
    }

    hub.start()
    expect(attempts).toBe(1)
    expect(hub.getStatuses()[0]?.error).toBe('bad event source')

    await vi.advanceTimersByTimeAsync(1000)
    expect(attempts).toBe(2)
  })

  it('returns no statuses when the registry cannot be listed', () => {
    ;(fake.registry as unknown as { list: () => never }).list = () => {
      throw new Error('db down')
    }

    hub.start()

    expect(hub.getStatuses()).toEqual([])
  })

  it('forgets the stream when the server cannot be read on change', async () => {
    hub.start()
    const stream = fake.latest('srv_a')
    stream.push(SERVER_CONNECTED)
    await flushPromises()

    ;(fake.registry as unknown as { get: (serverId: string) => never }).get = () => {
      throw new Error('db down')
    }
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(stream.signal.aborted).toBe(true)
  })

  it('keeps the version null when the version probe rejects', async () => {
    vi.mocked(fake.registry.test).mockRejectedValue(new Error('no info endpoint'))

    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: null, error: null },
    ])
  })
})

describe('RemoteServerEventHub pending action replay', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A], {
      permissions: { '/repo': [{ id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: ['ls'] }] },
      forms: { '/repo': [{ id: 'form-1', sessionID: 'ses-1', title: 'Continue?', fields: [] }] },
    })
    hub = new RemoteServerEventHub(fake.registry, sseAggregator)
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
  })

  async function trackSessionStatus(sessionID: string, directory: string, status: string): Promise<void> {
    fake.latest('srv_a').push(remoteEvent('session.status', { sessionID, status: { type: status } }, directory))
    await flushPromises()
  }

  it('replays pending remote actions to the subscribing client only', async () => {
    hub.start()
    await trackSessionStatus('ses-1', '/repo', 'busy')
    const client = createCapturingClient()
    const other = createCapturingClient()
    sseAggregator.addClient('replay-a', client.callback, client.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('replay-b', other.callback, other.writeFrame, ['srv_a|/other'])

    await flushPromises()

    expect(fake.api.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(fake.api.form.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })

    const parsed = client.frames.map(parseFrame)
    expect(parsed.map(frame => frame.serverId)).toEqual(['srv_a', 'srv_a'])
    expect(parsed.map(frame => frame.directory)).toEqual(['/repo', '/repo'])
    expect(parsed.map(frame => frame.payload.type)).toEqual(['permission.asked', 'form.created'])
    expect(parsed[0]?.payload.id).toMatch(/^ocm_replay_remote_/)
    expect(parsed[1]?.payload.data).toEqual({
      form: { id: 'form-1', sessionID: 'ses-1', title: 'Continue?', fields: [] },
    })
    expect(other.frames).toHaveLength(0)
  })

  it('skips the replay for a linked directory with no active session', async () => {
    hub.start()
    const client = createCapturingClient()
    sseAggregator.addClient('idle', client.callback, client.writeFrame, ['srv_a|/repo'])

    await flushPromises()

    expect(fake.api.permission.request.list).not.toHaveBeenCalled()
    expect(fake.api.form.list).not.toHaveBeenCalled()
    expect(client.frames).toHaveLength(0)
  })

  it('stops replaying for a linked directory once its session goes idle', async () => {
    hub.start()
    await trackSessionStatus('ses-1', '/repo', 'busy')
    await trackSessionStatus('ses-1', '/repo', 'idle')
    const client = createCapturingClient()
    sseAggregator.addClient('settled', client.callback, client.writeFrame, ['srv_a|/repo'])

    await flushPromises()

    expect(fake.api.permission.request.list).not.toHaveBeenCalled()
    expect(client.frames).toHaveLength(0)
  })

  it('resolves the directory of an active session before gating the replay', async () => {
    fake = createRegistry([SERVER_A], {
      active: { 'ses-1': { type: 'running' } },
      sessionDirectories: { 'ses-1': '/repo' },
      permissions: { '/repo': [{ id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: ['ls'] }] },
    })
    hub = new RemoteServerEventHub(fake.registry, sseAggregator)
    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    const client = createCapturingClient()
    sseAggregator.addClient('resolved', client.callback, client.writeFrame, ['srv_a|/repo'])
    await flushPromises()

    expect(fake.api.session.get).toHaveBeenCalledWith({ sessionID: 'ses-1' })
    expect(fake.api.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(client.frames.map(parseFrame).map(frame => frame.payload.type)).toEqual(['permission.asked'])
  })

  it('does not use the local pending action fetcher for remote keys', async () => {
    const localApi = makeApi({ permissions: { '/repo': [{ id: 'local-perm' }] } }, [])
    sseAggregator.setOpenCodeClient({ api: localApi })

    hub.start()
    await trackSessionStatus('ses-1', '/repo', 'busy')
    const client = createCapturingClient()
    sseAggregator.addClient('mixed', client.callback, client.writeFrame, ['/repo', 'srv_a|/repo'])

    await flushPromises()

    expect(localApi.permission.request.list).toHaveBeenCalledTimes(1)
    expect(localApi.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(fake.api.permission.request.list).toHaveBeenCalledTimes(1)
    expect(fake.api.permission.request.list).toHaveBeenCalledWith({ location: { directory: '/repo' } })
  })

  it('replays remote actions when a client subscribes later', async () => {
    hub.start()
    await trackSessionStatus('ses-1', '/repo', 'busy')
    const client = createCapturingClient()
    sseAggregator.addClient('late', client.callback, client.writeFrame, [])

    sseAggregator.addDirectories('late', ['srv_a|/repo'])
    await flushPromises()

    expect(client.frames.map(parseFrame).map(frame => frame.payload.type)).toEqual(['permission.asked', 'form.created'])
  })

  it('skips the replay when the client unsubscribed before it resolved', async () => {
    let resolvePermissions: (value: { location: { directory: string }; data: unknown[] }) => void = () => {}
    const list = fake.api.permission.request.list as unknown as (input: { location?: { directory?: string } }) => Promise<unknown>
    vi.mocked(list).mockImplementation(() => new Promise((resolve) => {
      resolvePermissions = resolve as (value: { location: { directory: string }; data: unknown[] }) => void
    }))
    vi.mocked(fake.api.form.list).mockResolvedValue({ location: { directory: '/repo' }, data: [] })

    hub.start()
    await trackSessionStatus('ses-1', '/repo', 'busy')
    const client = createCapturingClient()
    sseAggregator.addClient('unsubscribed', client.callback, client.writeFrame, ['srv_a|/repo'])
    sseAggregator.removeDirectories('unsubscribed', ['srv_a|/repo'])

    resolvePermissions({ location: { directory: '/repo' }, data: [{ id: 'late', sessionID: 'ses-1' }] })
    await flushPromises()

    expect(client.frames).toHaveLength(0)
  })
})

describe('RemoteServerEventHub session status replay', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
  })

  function createHub(fixture: ApiFixture = {}): void {
    fake = createRegistry([SERVER_A], fixture)
    hub = new RemoteServerEventHub(fake.registry, sseAggregator)
  }

  function statusFrames(client: CapturedClient) {
    return client.frames.map(parseFrame).filter(frame => frame.payload.type === 'session.status')
  }

  async function trackSessionThenReconnect(sessionID: string, directory: string): Promise<void> {
    hub.start()
    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()
    fake.latest('srv_a').push(remoteEvent('session.created', { sessionID }, directory))
    await flushPromises()
    fake.emit({ type: 'upserted', serverId: 'srv_a' })
    await flushPromises()
  }

  it('replays idle for a tracked session that is no longer active', async () => {
    createHub()
    await trackSessionThenReconnect('ses_1', '/repo')
    const client = createCapturingClient()
    sseAggregator.addClient('status-idle', client.callback, client.writeFrame, ['srv_a|/repo'])

    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    const statuses = statusFrames(client)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.serverId).toBe('srv_a')
    expect(statuses[0]?.directory).toBe('/repo')
    expect(statuses[0]?.payload.id).toMatch(/^ocm_replay_remote_/)
    expect(statuses[0]?.payload.data).toEqual({ sessionID: 'ses_1', status: { type: 'idle' } })
  })

  it('replays busy for active sessions, using a null directory when the session is untracked', async () => {
    createHub({ active: { ses_1: { type: 'running' }, ses_2: { type: 'running' } } })
    await trackSessionThenReconnect('ses_1', '/repo')
    const client = createCapturingClient()
    sseAggregator.addClient('status-busy', client.callback, client.writeFrame, ['srv_a|/repo'])

    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    const statuses = statusFrames(client)
    expect(statuses.map(frame => frame.directory)).toEqual(['/repo', null])
    expect(statuses.map(frame => frame.payload.data)).toEqual([
      { sessionID: 'ses_1', status: { type: 'busy' } },
      { sessionID: 'ses_2', status: { type: 'busy' } },
    ])
  })

  it('does not replay or throw when the active session lookup fails', async () => {
    createHub()
    vi.mocked(fake.api.session.active).mockRejectedValue(new Error('sessions unavailable'))
    await trackSessionThenReconnect('ses_1', '/repo')
    const client = createCapturingClient()
    sseAggregator.addClient('status-failure', client.callback, client.writeFrame, ['srv_a|/repo'])

    fake.latest('srv_a').push(SERVER_CONNECTED)
    await flushPromises()

    expect(fake.api.session.active).toHaveBeenCalledTimes(2)
    expect(statusFrames(client)).toHaveLength(0)
  })

  it('skips the replay when the stream disconnects before the active sessions resolve', async () => {
    createHub()
    const client = createCapturingClient()
    sseAggregator.addClient('status-stale', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const first = fake.latest('srv_a')
    first.push(SERVER_CONNECTED)
    await flushPromises()
    first.push(remoteEvent('session.created', { sessionID: 'ses_1' }, '/repo'))
    await flushPromises()

    let resolveActive: (value: Record<string, { type: 'running' }>) => void = () => {}
    vi.mocked(fake.api.session.active).mockReturnValueOnce(new Promise<Record<string, { type: 'running' }>>((resolve) => {
      resolveActive = resolve
    }) as never)

    fake.emit({ type: 'upserted', serverId: 'srv_a' })
    const second = fake.latest('srv_a')
    second.push(SERVER_CONNECTED)
    await flushPromises()
    expect(fake.api.session.active).toHaveBeenCalledTimes(2)

    second.fail(new Error('connection lost'))
    await flushPromises()
    resolveActive({})
    await flushPromises()

    expect(statusFrames(client)).toHaveLength(0)
  })
})
