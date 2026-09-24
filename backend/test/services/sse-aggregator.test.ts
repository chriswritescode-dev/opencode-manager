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

import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
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

interface RawEventInput {
  id?: string
  created?: number
  type: string
  location?: { directory: string }
  data?: unknown
}

function rawEvent(input: RawEventInput): string {
  return JSON.stringify({
    id: input.id ?? 'evt_1',
    created: input.created ?? 1,
    type: input.type,
    ...(input.location ? { location: input.location } : {}),
    data: input.data ?? {},
  })
}

function parseFrame(frame: string): { directory: string | null; payload: { id?: string; type: string; data: Record<string, unknown> } } {
  return JSON.parse(frame.replace(/^event: message\ndata: /, '').trim())
}

interface ApiFixture {
  permissions?: Record<string, unknown[]>
  forms?: Record<string, unknown[]>
  active?: Record<string, { type: 'running' }>
  sessions?: Record<string, { directory: string }>
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
    session: {
      active: vi.fn(async () => fixture.active ?? {}),
      get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
        const session = fixture.sessions?.[sessionID]
        if (!session) throw new Error(`unknown session: ${sessionID}`)
        return { location: { directory: session.directory } }
      }),
    },
  } as unknown as OpenCodeApi
}

function makeFetcher(fixture: ApiFixture = {}): PendingActionsFetcher {
  return { api: makeApi(fixture) }
}

function emitRawEvent(input: RawEventInput): void {
  ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage(rawEvent(input))
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

describe('SSEAggregator raw V2 event handling', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('marks a session active from a raw V2 session.status busy event and routes it only to subscribed clients', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('active-a', clientA.callback, clientA.writeFrame, ['/r'])
    sseAggregator.addClient('active-b', clientB.callback, clientB.writeFrame, ['/other'])

    emitRawEvent({
      id: 'evt_1',
      type: 'session.status',
      location: { directory: '/r' },
      data: { sessionID: 'ses_1', status: { type: 'busy' } },
    })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_1'] })
    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
    expect(parseFrame(clientA.frames[0]!)).toEqual({
      directory: '/r',
      payload: {
        id: 'evt_1',
        created: 1,
        type: 'session.status',
        location: { directory: '/r' },
        data: { sessionID: 'ses_1', status: { type: 'busy' } },
      },
    })
  })

  it('delivers events without a location directory to every connected client with a null directory', () => {
    const subscribed = createCapturingClient()
    const unsubscribed = createCapturingClient()
    sseAggregator.addClient('global-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    sseAggregator.addClient('global-b', unsubscribed.callback, unsubscribed.writeFrame, [])

    emitRawEvent({ id: 'evt_global', type: 'server.connected', data: {} })

    const expected = {
      directory: null,
      payload: { id: 'evt_global', created: 1, type: 'server.connected', data: {} },
    }
    expect(subscribed.frames.map(parseFrame)).toEqual([expected])
    expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('embeds the raw upstream payload in the client envelope without re-serializing it', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('raw-a', client.callback, client.writeFrame, ['/r'])
    const raw = '{"type":"session.idle","id":"evt_raw","created":7,"location":{"directory":"/r"},"data":{"sessionID":"ses_1","extra":{"b":2,"a":1}}}'

    ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage(raw)

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/r","payload":${raw}}\n\n`])
    expect(parseFrame(client.frames[0]!)).toEqual({ directory: '/r', payload: JSON.parse(raw) })
  })

  it('re-serializes a multi-line upstream payload so the client frame stays a single data line', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('raw-b', client.callback, client.writeFrame, ['/r'])
    const event = { type: 'session.idle', id: 'evt_ml', created: 3, location: { directory: '/r' }, data: { sessionID: 'ses_1' } }

    ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage(JSON.stringify(event, null, 2))

    expect(client.frames).toHaveLength(1)
    expect(client.frames[0]!.split('\n').filter(line => line.startsWith('data: '))).toHaveLength(1)
    expect(parseFrame(client.frames[0]!)).toEqual({ directory: '/r', payload: event })
  })

  it('marks a session idle on session.idle and on terminal execution events', () => {
    emitRawEvent({ type: 'session.status', location: { directory: '/r' }, data: { sessionID: 'ses_1', status: { type: 'busy' } } })
    emitRawEvent({ type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_2' } })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_1', 'ses_2'] })

    emitRawEvent({ type: 'session.execution.succeeded', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_2'] })

    emitRawEvent({ type: 'session.execution.failed', location: { directory: '/r' }, data: { sessionID: 'ses_2', error: { type: 'unknown', message: 'boom' } } })
    emitRawEvent({ type: 'session.status', location: { directory: '/r' }, data: { sessionID: 'ses_3', status: { type: 'retry', attempt: 1, message: 'retrying', next: 1 } } })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_3'] })

    emitRawEvent({ type: 'session.idle', location: { directory: '/r' }, data: { sessionID: 'ses_3' } })
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('marks a session idle on session.execution.interrupted', () => {
    emitRawEvent({ type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    emitRawEvent({ type: 'session.execution.interrupted', location: { directory: '/r' }, data: { sessionID: 'ses_1', reason: 'shutdown' } })

    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('records subagent sessions from session.created parentID and forgets deleted ones', () => {
    emitRawEvent({
      type: 'session.created',
      location: { directory: '/r' },
      data: { sessionID: 'ses_sub', parentID: 'ses_root', projectID: 'p', location: { directory: '/r' }, slug: 'sub', version: '2.0.15' },
    })

    expect(sseAggregator.isSubagentSession('ses_sub')).toBe(true)

    emitRawEvent({ type: 'session.deleted', location: { directory: '/r' }, data: { sessionID: 'ses_sub' } })

    expect(sseAggregator.isSubagentSession('ses_sub')).toBe(false)
  })

  it('ignores malformed upstream payloads', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('malformed-a', client.callback, client.writeFrame, ['/r'])

    ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage('not-json')
    ;(sseAggregator as unknown as { handleUpstreamMessage(data: string): void }).handleUpstreamMessage(rawEvent({
      type: 'session.status',
      location: { directory: '/r' },
      data: null,
    }))

    expect(client.frames).toHaveLength(0)
  })
})

describe('SSEAggregator pending replay on connect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('replays pending permissions and forms from the V2 api per subscribed directory', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      permissions: {
        '/repo/a': [
          { id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['rm -rf node_modules'] },
          { id: 'perm-2', sessionID: 'ses-a', action: 'edit', resources: ['src/index.ts'] },
        ],
        '/repo/b': [{ id: 'perm-3', sessionID: 'ses-b', action: 'read', resources: ['README.md'] }],
      },
      forms: {
        '/repo/a': [{ id: 'form-1', sessionID: 'ses-a', title: 'Deploy to prod?', fields: [] }],
      },
    }))

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-1', callback, writeFrame, ['/repo/a', '/repo/b'])

    await flushReplay()

    expect(events).toHaveLength(4)

    const parsed = events.map(e => JSON.parse(e.data) as {
      directory: string
      payload: { id: string; created: number; type: string; location: { directory: string }; data: Record<string, unknown> }
    })

    const permissionsA = parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/a')
    expect(permissionsA.map(p => p.payload.data.id)).toEqual(['perm-1', 'perm-2'])
    expect(permissionsA[0]?.payload.id).toMatch(/^ocm_replay_/)
    expect(permissionsA[0]?.payload.location).toEqual({ directory: '/repo/a' })
    expect(permissionsA[0]?.payload.data).toEqual({
      id: 'perm-1',
      sessionID: 'ses-a',
      action: 'shell',
      resources: ['rm -rf node_modules'],
    })

    const formsA = parsed.filter(p => p.payload.type === 'form.created' && p.directory === '/repo/a')
    expect(formsA).toHaveLength(1)
    expect(formsA[0]?.payload.data).toEqual({
      form: { id: 'form-1', sessionID: 'ses-a', title: 'Deploy to prod?', fields: [] },
    })

    expect(parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/b').map(p => p.payload.data.id)).toEqual(['perm-3'])
    expect(parsed.filter(p => p.payload.type === 'form.created' && p.directory === '/repo/b')).toHaveLength(0)
  })

  it('does not replay when no api is configured', async () => {
    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-2', callback, writeFrame, ['/repo/a'])

    await flushReplay()

    expect(events).toHaveLength(0)
  })

  it('does not replay to other clients', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      permissions: { '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] },
    }))

    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    sseAggregator.addClient('a', clientA.callback, clientA.writeFrame, ['/repo/a'])
    sseAggregator.addClient('b', clientB.callback, clientB.writeFrame, [])

    await flushReplay()

    expect(clientA.events).toHaveLength(1)
    expect(clientB.events).toHaveLength(0)
  })

  it('replays only newly added directories on addDirectories', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      permissions: {
        '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }],
        '/repo/b': [{ id: 'perm-2', sessionID: 'ses-b', action: 'shell', resources: ['ls'] }],
      },
    }))

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-3', callback, writeFrame, ['/repo/a'])
    await flushReplay()

    const initialCount = events.length
    expect(initialCount).toBe(1)

    sseAggregator.addDirectories('client-3', ['/repo/a', '/repo/b'])
    await flushReplay()

    const parsed = events.slice(initialCount).map(e => JSON.parse(e.data) as {
      directory: string
      payload: { data: Record<string, unknown> }
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.directory).toBe('/repo/b')
    expect(parsed[0]?.payload.data.id).toBe('perm-2')
  })

  it('survives upstream fetch failures for one directory and still replays the others', async () => {
    const api = makeApi({
      permissions: { '/repo/ok': [{ id: 'perm-ok', sessionID: 'ses-ok', action: 'shell', resources: ['ls'] }] },
    })
    const list = api.permission.request.list as unknown as (input: { location?: { directory?: string } }) => Promise<unknown>
    vi.mocked(list).mockImplementation(async (input) => {
      if (input?.location?.directory === '/repo/broken') throw new Error('upstream down')
      return { location: { directory: input?.location?.directory ?? '' }, data: [{ id: 'perm-ok', sessionID: 'ses-ok', action: 'shell', resources: ['ls'] }] }
    })
    sseAggregator.setPendingActionsFetcher({ api })

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-4', callback, writeFrame, ['/repo/broken', '/repo/ok'])
    await flushReplay()

    const parsed = events.map(e => JSON.parse(e.data) as { directory: string; payload: { data: Record<string, unknown> } })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.directory).toBe('/repo/ok')
    expect(parsed[0]?.payload.data.id).toBe('perm-ok')
  })

  it('does not deliver replay events to a client that no longer subscribes to that directory', async () => {
    let resolvePermissions: (value: { location: { directory: string }; data: unknown[] }) => void = () => {}
    const api = makeApi()
    const list = api.permission.request.list as unknown as (input: { location?: { directory?: string } }) => Promise<unknown>
    vi.mocked(list).mockImplementation(() => new Promise((resolve) => {
      resolvePermissions = resolve as (value: { location: { directory: string }; data: unknown[] }) => void
    }))
    sseAggregator.setPendingActionsFetcher({ api })

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-5', callback, writeFrame, ['/repo/a'])

    sseAggregator.removeDirectories('client-5', ['/repo/a'])
    resolvePermissions({ location: { directory: '/repo/a' }, data: [{ id: 'late', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] })

    await flushReplay()

    expect(events).toHaveLength(0)
  })
})

describe('SSEAggregator session status replay on upstream reconnect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('re-emits busy for a tracked session that is still running', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('status-1', client.callback, client.writeFrame, ['/repo/a'])

    emitRawEvent({ type: 'session.status', location: { directory: '/repo/a' }, data: { sessionID: 'ses-1', status: { type: 'busy' } } })

    sseAggregator.setPendingActionsFetcher(makeFetcher({ active: { 'ses-1': { type: 'running' } } }))

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    const statuses = client.frames.map(parseFrame).filter(p => p.payload.type === 'session.status')
    expect(statuses).toHaveLength(2)
    expect(statuses.at(-1)?.payload.data).toEqual({ sessionID: 'ses-1', status: { type: 'busy' } })
  })

  it('emits idle for a tracked session that finished during the disconnect', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('status-2', client.callback, client.writeFrame, ['/repo/a'])

    emitRawEvent({ type: 'session.status', location: { directory: '/repo/a' }, data: { sessionID: 'ses-9', status: { type: 'busy' } } })

    sseAggregator.setPendingActionsFetcher(makeFetcher({ active: {} }))

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    const idle = client.frames.map(parseFrame).filter(p => p.payload.type === 'session.status' && (p.payload.data.status as { type?: string })?.type === 'idle')
    expect(idle).toHaveLength(1)
    expect(idle[0]?.payload.data).toEqual({ sessionID: 'ses-9', status: { type: 'idle' } })
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('resolves the directory for a running session that is not tracked', async () => {
    const api = makeApi({
      active: { 'ses-new': { type: 'running' } },
      sessions: { 'ses-new': { directory: '/repo/new' } },
    })
    sseAggregator.setPendingActionsFetcher({ api })

    const client = createCapturingClient()
    sseAggregator.addClient('status-3', client.callback, client.writeFrame, ['/repo/new'])

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(api.session.get).toHaveBeenCalledWith({ sessionID: 'ses-new' })
    const statuses = client.frames.map(parseFrame).filter(p => p.payload.type === 'session.status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.directory).toBe('/repo/new')
    expect(statuses[0]?.payload.data).toEqual({ sessionID: 'ses-new', status: { type: 'busy' } })
  })

  it('resolves untracked running session directories concurrently', async () => {
    const api = makeApi({ active: { 'ses-x': { type: 'running' }, 'ses-y': { type: 'running' } } })
    const pending: Array<() => void> = []
    vi.mocked(api.session.get).mockImplementation((input) => new Promise((resolve) => {
      const sessionID = (input as { sessionID: string }).sessionID
      pending.push(() => resolve({ location: { directory: `/repo/${sessionID}` } } as unknown as Awaited<ReturnType<OpenCodeApi['session']['get']>>))
    }))
    sseAggregator.setPendingActionsFetcher({ api })

    const client = createCapturingClient()
    sseAggregator.addClient('status-5', client.callback, client.writeFrame, ['/repo/ses-x', '/repo/ses-y'])

    const replay = (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(api.session.get).toHaveBeenCalledTimes(2)
    pending.forEach(resolve => resolve())
    await replay

    expect(client.frames.map(parseFrame).map(p => p.directory).sort()).toEqual(['/repo/ses-x', '/repo/ses-y'])
  })

  it('does not replay pending actions to already connected clients on upstream reconnect', async () => {
    const fetcher = makeFetcher({
      permissions: { '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)
    const client = createCapturingClient()
    sseAggregator.addClient('status-6', client.callback, client.writeFrame, ['/repo/a'])
    await flushReplay()
    vi.mocked(fetcher.api.permission.request.list).mockClear()
    vi.mocked(fetcher.api.form.list).mockClear()

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(true)
    await flushReplay()

    expect(fetcher.api.permission.request.list).not.toHaveBeenCalled()
    expect(fetcher.api.form.list).not.toHaveBeenCalled()
    expect(fetcher.api.session.active).toHaveBeenCalledTimes(1)
    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(1)
    expect(client.events.filter(event => event.event === 'message')).toHaveLength(1)
  })

  it('does nothing when no api is configured', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('status-4', client.callback, client.writeFrame, ['/repo/a'])

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(client.frames).toHaveLength(0)
  })
})

describe('SSEAggregator scheduled session replay without a connected client', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('replays a scheduled directory that no browser client is subscribed to', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      active: { 'ses-sched': { type: 'running' } },
    }))
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-sched', directory: '/worktrees/run-1' },
    ])

    const seen: Array<{ directory: string; type: string; sessionID: string; status: string }> = []
    sseAggregator.onEvent((directory, event) => {
      if (event.type !== 'session.status') return
      seen.push({
        directory,
        type: event.type,
        sessionID: event.data.sessionID,
        status: event.data.status.type,
      })
    })

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(seen).toEqual([
      { directory: '/worktrees/run-1', type: 'session.status', sessionID: 'ses-sched', status: 'busy' },
    ])
  })

  it('emits idle for a scheduled session that finished while the stream was down and was never marked active', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({ active: {} }))
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-finished', directory: '/worktrees/run-2' },
    ])

    const idle: string[] = []
    sseAggregator.onEvent((_directory, event) => {
      if (event.type === 'session.status' && event.data.status.type === 'idle') {
        idle.push(event.data.sessionID)
      }
    })

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(idle).toEqual(['ses-finished'])
  })
})

describe('SSEAggregator upstream resynchronization signal', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('broadcasts a resync control event on the first and every later upstream connect', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('resync-1', client.callback, client.writeFrame, ['/repo/a'])

    const openUpstream = (sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen.bind(sseAggregator)
    openUpstream(false)
    openUpstream(true)

    const resyncs = client.events.filter(event => event.event === 'resync')
    expect(resyncs).toHaveLength(2)
    expect(JSON.parse(resyncs[0]!.data)).toMatchObject({ timestamp: expect.any(Number) })
    expect(client.frames).toHaveLength(0)
  })

  it('delivers resync to a client that subscribed before the upstream was ever connected', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('resync-2', client.callback, client.writeFrame, ['/repo/a'])

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(false)

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(1)
  })
})

describe('SSEAggregator directory-indexed broadcast', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('delivers only to clients subscribed to the event directory', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('index-a', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-b', clientB.callback, clientB.writeFrame, ['/b'])

    emitRawEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
  })

  it('does not encode a frame when no client subscribes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-c', clientA.callback, clientA.writeFrame, ['/a'])

    emitRawEvent({ type: 'session.idle', location: { directory: '/z' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(0)
  })

  it('removeClient deindexes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-d', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.removeClient('index-d')

    emitRawEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(0)
  })

  it('addDirectories then delivery', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-e', clientA.callback, clientA.writeFrame, [])
    sseAggregator.addDirectories('index-e', ['/a'])

    emitRawEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(1)
  })

  it('replacing a client ID deindexes old directories', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    sseAggregator.addClient('index-f', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-f', clientB.callback, clientB.writeFrame, ['/b'])

    emitRawEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })
    expect(clientA.frames).toHaveLength(0)
    expect(clientB.frames).toHaveLength(0)

    emitRawEvent({ type: 'session.idle', location: { directory: '/b' }, data: { sessionID: 'ses-1' } })
    expect(clientB.frames).toHaveLength(1)
  })
})
