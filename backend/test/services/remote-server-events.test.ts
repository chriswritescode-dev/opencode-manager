import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { sseAggregator } from '../../src/services/sse-aggregator'
import {
  RemoteServerEventHub,
  type RemoteEventSource,
  type RemoteEventSourceFactory,
  type RemoteEventSourceInit,
} from '../../src/services/remote-server-events'
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

class FakeEventSource implements RemoteEventSource {
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false

  constructor(
    readonly url: string,
    readonly init?: RemoteEventSourceInit,
  ) {}

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.({})
  }

  fail(event: unknown = { message: 'connection lost' }): void {
    this.onerror?.(event)
  }

  message(data: string): void {
    this.onmessage?.({ data })
  }
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
}

function makeApi(fixture: ApiFixture = {}): OpenCodeApi {
  const directoryOf = (input?: { location?: { directory?: string } }): string => input?.location?.directory ?? ''

  return {
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
  } as unknown as OpenCodeApi
}

interface FakeRegistry {
  registry: OpenCodeServerRegistry
  api: OpenCodeApi
  emit: (change: OpenCodeServerChange) => void
  setServer: (server: OpenCodeServer) => void
  removeServer: (serverId: string) => void
  listCalls: () => number
}

function createRegistry(servers: OpenCodeServer[], fixture: ApiFixture = {}): FakeRegistry {
  const byId = new Map(servers.map(server => [server.id, server]))
  const listeners = new Set<(change: OpenCodeServerChange) => void>()
  const api = makeApi(fixture)
  let listCalls = 0

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
    getClient: () => ({ api }),
    onChange: (listener: (change: OpenCodeServerChange) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    test: vi.fn(async () => ({ ok: true, version: '2.0.15', versionSupported: true, error: null })),
  } as unknown as OpenCodeServerRegistry

  return {
    registry,
    api,
    emit: (change) => { listeners.forEach(listener => listener(change)) },
    setServer: (server) => { byId.set(server.id, server) },
    removeServer: (serverId) => { byId.delete(serverId) },
    listCalls: () => listCalls,
  }
}

function createSourceFactory() {
  const sources: FakeEventSource[] = []
  const factory: RemoteEventSourceFactory = (url, init) => {
    const source = new FakeEventSource(url, init)
    sources.push(source)
    return source
  }
  return {
    sources,
    factory,
    latest: () => sources[sources.length - 1]!,
  }
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

function remoteEvent(type: string, data: unknown, directory?: string): string {
  return JSON.stringify({
    id: 'evt_1',
    created: 1,
    type,
    ...(directory ? { location: { directory } } : {}),
    data,
  })
}

describe('RemoteServerEventHub event delivery', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry
  let sources: ReturnType<typeof createSourceFactory>

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A, SERVER_B])
    sources = createSourceFactory()
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, { eventSourceFactory: sources.factory })
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
  })

  it('opens one stream per enabled server with the connection authorization', () => {
    hub.start()

    expect(sources.sources.map(source => source.url)).toEqual([
      'https://studio.example.com/api/event',
      'https://laptop.example.com/api/event',
    ])
    expect(sources.sources[0]?.init?.fetch).toBeTypeOf('function')
    expect(sources.sources[1]?.init).toBeUndefined()
  })

  it('delivers a located event only to clients subscribed to that server and directory, with a serverId envelope', () => {
    const remoteClient = createCapturingClient()
    const otherServerClient = createCapturingClient()
    const localClient = createCapturingClient()
    sseAggregator.addClient('remote-a', remoteClient.callback, remoteClient.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('remote-b', otherServerClient.callback, otherServerClient.writeFrame, ['srv_b|/repo'])
    sseAggregator.addClient('local-a', localClient.callback, localClient.writeFrame, ['/repo'])

    const listener = vi.fn()
    sseAggregator.onEvent(listener)

    hub.start()
    const source = sources.sources[0]!
    source.open()
    remoteClient.frames.length = 0

    source.message(remoteEvent('session.idle', { sessionID: 'ses_1' }, '/repo'))

    expect(remoteClient.frames.map(parseFrame)).toEqual([{
      directory: '/repo',
      serverId: 'srv_a',
      payload: {
        id: 'evt_1',
        created: 1,
        type: 'session.idle',
        location: { directory: '/repo' },
        data: { sessionID: 'ses_1' },
      },
    }])
    expect(otherServerClient.frames).toHaveLength(0)
    expect(localClient.frames).toHaveLength(0)
    expect(listener).not.toHaveBeenCalled()
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('resolves a directory-less event through the per-server session map', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('session-map', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const source = sources.sources[0]!
    source.message(remoteEvent('session.created', { sessionID: 'ses_1', parentID: null }, '/repo'))
    client.frames.length = 0

    source.message(remoteEvent('session.execution.succeeded', { sessionID: 'ses_1' }))

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

  it('inherits the parent directory for a forked session and forgets deleted sessions', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('fork', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const source = sources.sources[0]!
    source.message(remoteEvent('session.created', { sessionID: 'ses_parent' }, '/repo'))
    source.message(remoteEvent('session.forked', { sessionID: 'ses_fork', parentID: 'ses_parent' }))
    client.frames.length = 0

    source.message(remoteEvent('session.execution.succeeded', { sessionID: 'ses_fork' }))
    expect(client.frames.map(parseFrame).map(frame => frame.directory)).toEqual(['/repo'])

    source.message(remoteEvent('session.deleted', { sessionID: 'ses_fork' }))
    client.frames.length = 0
    source.message(remoteEvent('session.execution.succeeded', { sessionID: 'ses_fork' }))

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

  it('falls back to every client holding any key of the server when the directory is unknown', () => {
    const subscribedA = createCapturingClient()
    const otherDirectoryA = createCapturingClient()
    const subscribedB = createCapturingClient()
    sseAggregator.addClient('any-a', subscribedA.callback, subscribedA.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('other-a', otherDirectoryA.callback, otherDirectoryA.writeFrame, ['srv_a|/elsewhere'])
    sseAggregator.addClient('any-b', subscribedB.callback, subscribedB.writeFrame, ['srv_b|/repo'])

    hub.start()
    sources.sources[0]!.message(remoteEvent('server.connected', {}))

    const envelope = {
      directory: null,
      serverId: 'srv_a',
      payload: { id: 'evt_1', created: 1, type: 'server.connected', data: {} },
    }
    expect(subscribedA.frames.map(parseFrame)).toEqual([envelope])
    expect(otherDirectoryA.frames.map(parseFrame)).toEqual([envelope])
    expect(subscribedB.frames).toHaveLength(0)
  })

  it('keeps the raw upstream payload in the remote envelope and re-serializes multi-line payloads', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('raw-remote', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const source = sources.sources[0]!
    const raw = '{"type":"session.idle","id":"evt_raw","created":7,"location":{"directory":"/repo"},"data":{"sessionID":"ses_1","extra":{"b":2,"a":1}}}'
    source.message(raw)

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/repo","serverId":"srv_a","payload":${raw}}\n\n`])

    const multiLine = JSON.stringify(JSON.parse(raw), null, 2)
    source.message(multiLine)

    expect(client.frames[1]!.split('\n').filter(line => line.startsWith('data: '))).toHaveLength(1)
    expect(parseFrame(client.frames[1]!).payload).toEqual(JSON.parse(raw))
  })

  it('ignores malformed remote payloads', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('malformed-remote', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const source = sources.sources[0]!
    source.message('not-json')
    source.message(JSON.stringify({ id: 'evt', created: 1, data: {} }))

    expect(client.frames).toHaveLength(0)
  })
})

describe('RemoteServerEventHub reconnection', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry
  let sources: ReturnType<typeof createSourceFactory>

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A])
    sources = createSourceFactory()
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, {
      eventSourceFactory: sources.factory,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 4000,
    })
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
    vi.useRealTimers()
  })

  it('sends a resync to the subscribers of the server on connect', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('resync-a', clientA.callback, clientA.writeFrame, ['srv_a|/repo'])
    sseAggregator.addClient('resync-b', clientB.callback, clientB.writeFrame, ['srv_b|/repo'])

    hub.start()
    sources.sources[0]!.open()

    const resyncs = clientA.events.filter(event => event.event === 'resync')
    expect(resyncs).toHaveLength(1)
    expect(JSON.parse(resyncs[0]!.data)).toMatchObject({ timestamp: expect.any(Number) })
    expect(clientB.events.filter(event => event.event === 'resync')).toHaveLength(0)
  })

  it('closes the failed stream and reconnects with exponential backoff', async () => {
    vi.useFakeTimers()
    hub.start()
    const first = sources.sources[0]!
    first.open()
    await flushPromises()
    first.fail({ message: 'Unauthorized', code: 401 })

    expect(first.closed).toBe(true)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: '2.0.15', error: 'Unauthorized' },
    ])

    await vi.advanceTimersByTimeAsync(999)
    expect(sources.sources).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(sources.sources).toHaveLength(2)

    const second = sources.sources[1]!
    second.fail({ message: 'Unauthorized', code: 401 })

    await vi.advanceTimersByTimeAsync(1000)
    expect(sources.sources).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(sources.sources).toHaveLength(3)
  })

  it('reports the version lazily from the registry without polling', async () => {
    hub.start()
    sources.sources[0]!.open()
    await flushPromises()
    sources.sources[0]!.open()
    await flushPromises()

    expect(fake.registry.test).toHaveBeenCalledTimes(1)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: '2.0.15', error: null },
    ])
  })

  it('closes and forgets the stream when the server is disabled', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('disable', client.callback, client.writeFrame, ['srv_a|/repo'])

    hub.start()
    const source = sources.sources[0]!
    source.open()
    client.frames.length = 0

    fake.setServer({ ...SERVER_A, enabled: false })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(source.closed).toBe(true)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: null, error: null },
    ])

    source.message(remoteEvent('session.idle', { sessionID: 'ses_1' }, '/repo'))
    expect(client.frames).toHaveLength(0)
  })

  it('reconnects with a fresh stream when the server is updated', () => {
    hub.start()
    const first = sources.sources[0]!
    first.open()

    fake.setServer({ ...SERVER_A, baseUrl: 'https://moved.example.com' })
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(first.closed).toBe(true)
    expect(sources.sources).toHaveLength(2)
    expect(sources.sources[1]!.url).toBe('https://moved.example.com/api/event')
  })

  it('closes the stream when the server is deleted', () => {
    hub.start()
    const source = sources.sources[0]!
    source.open()

    fake.removeServer('srv_a')
    fake.emit({ type: 'deleted', serverId: 'srv_a' })

    expect(source.closed).toBe(true)
    expect(hub.getStatuses()).toEqual([])
  })

  it('stops reconnecting and clears the replay hook after shutdown', () => {
    hub.start()
    const source = sources.sources[0]!
    source.open()
    hub.shutdown()

    expect(source.closed).toBe(true)

    const client = createCapturingClient()
    sseAggregator.addClient('after-shutdown', client.callback, client.writeFrame, ['srv_a|/repo'])
    expect(fake.api.permission.request.list).not.toHaveBeenCalled()
  })
})

describe('RemoteServerEventHub failure handling', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry
  let sources: ReturnType<typeof createSourceFactory>

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A])
    sources = createSourceFactory()
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, {
      eventSourceFactory: sources.factory,
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

    const first = sources.sources[0]!
    first.fail(new Error('boom'))
    expect(hub.getStatuses()[0]?.error).toBe('boom')

    await vi.advanceTimersByTimeAsync(1000)
    sources.sources[1]!.fail('plain failure')
    expect(hub.getStatuses()[0]?.error).toBe('plain failure')

    await vi.advanceTimersByTimeAsync(2000)
    sources.sources[2]!.fail({ code: 500 })
    expect(hub.getStatuses()[0]?.error).toBe('event stream closed (code=500)')

    await vi.advanceTimersByTimeAsync(4000)
    sources.sources[3]!.fail({})
    expect(hub.getStatuses()[0]?.error).toBe('event stream disconnected')
    expect(hub.getStatuses()[0]?.error).not.toContain('Basic')
    expect(hub.getStatuses()[0]?.error).not.toContain('studio.example.com')
  })

  it('records a connection failure without credentials and without opening a stream', () => {
    ;(fake.registry as unknown as { getConnection: (serverId: string) => never }).getConnection = () => {
      throw new Error('OpenCode server is disabled: srv_a')
    }

    hub.start()

    expect(sources.sources).toHaveLength(0)
    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: false, version: null, error: 'OpenCode server is disabled: srv_a' },
    ])
  })

  it('retries with backoff when the event source cannot be created', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const factory: RemoteEventSourceFactory = () => {
      attempts += 1
      throw new Error('bad event source')
    }
    hub.shutdown()
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, { eventSourceFactory: factory, reconnectDelayMs: 1000 })

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

  it('forgets the stream when the server cannot be read on change', () => {
    hub.start()
    const source = sources.sources[0]!
    source.open()

    ;(fake.registry as unknown as { get: (serverId: string) => never }).get = () => {
      throw new Error('db down')
    }
    fake.emit({ type: 'upserted', serverId: 'srv_a' })

    expect(source.closed).toBe(true)
  })

  it('keeps the version null when the version probe rejects', async () => {
    vi.mocked(fake.registry.test).mockRejectedValue(new Error('no info endpoint'))

    hub.start()
    sources.sources[0]!.open()
    await flushPromises()

    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: null, error: null },
    ])
  })

  it('keeps the version null when the registry cannot test a server', async () => {
    ;(fake.registry as unknown as { test?: unknown }).test = undefined

    hub.start()
    sources.sources[0]!.open()
    await flushPromises()

    expect(hub.getStatuses()).toEqual([
      { serverId: 'srv_a', connected: true, version: null, error: null },
    ])
  })
})

describe('RemoteServerEventHub pending action replay', () => {
  let hub: RemoteServerEventHub
  let fake: FakeRegistry
  let sources: ReturnType<typeof createSourceFactory>

  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    fake = createRegistry([SERVER_A], {
      permissions: { '/repo': [{ id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: ['ls'] }] },
      forms: { '/repo': [{ id: 'form-1', sessionID: 'ses-1', title: 'Continue?', fields: [] }] },
    })
    sources = createSourceFactory()
    hub = new RemoteServerEventHub(fake.registry, sseAggregator, { eventSourceFactory: sources.factory })
  })

  afterEach(() => {
    hub.shutdown()
    sseAggregator.shutdown()
  })

  it('replays pending remote actions to the subscribing client only', async () => {
    hub.start()
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

  it('does not use the local pending action fetcher for remote keys', async () => {
    const localApi = makeApi({ permissions: { '/repo': [{ id: 'local-perm' }] } })
    sseAggregator.setPendingActionsFetcher({ api: localApi })

    hub.start()
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
    const client = createCapturingClient()
    sseAggregator.addClient('unsubscribed', client.callback, client.writeFrame, ['srv_a|/repo'])
    sseAggregator.removeDirectories('unsubscribed', ['srv_a|/repo'])

    resolvePermissions({ location: { directory: '/repo' }, data: [{ id: 'late', sessionID: 'ses-1' }] })
    await flushPromises()

    expect(client.frames).toHaveLength(0)
  })
})
