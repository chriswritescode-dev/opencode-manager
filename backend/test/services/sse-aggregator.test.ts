import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
  },
  getWorkspacePath: () => '/workspace',
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import type { OpenCodeApi, V2Event } from '@opencode-manager/shared/opencode'
import { buildOpenCodeBasicAuth, sessionIDFromEvent } from '@opencode-manager/shared/opencode'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { getOpenCodeUpstreamBaseUrl } from '../../src/services/opencode/upstream'

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

interface EventInput {
  id?: string
  created?: number
  type: string
  location?: { directory: string }
  data?: unknown
}

function eventOf(input: EventInput): V2Event {
  return {
    id: input.id ?? 'evt_1',
    created: input.created ?? 1,
    type: input.type,
    ...(input.location ? { location: input.location } : {}),
    data: input.data ?? {},
  } as unknown as V2Event
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

function makeClient(fixture: ApiFixture = {}): { api: OpenCodeApi } {
  return { api: makeApi(fixture) }
}

function emitEvent(input: EventInput): void {
  ;(sseAggregator as unknown as { handleUpstreamEvent(event: V2Event): void }).handleUpstreamEvent(eventOf(input))
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

describe('SSEAggregator V2 event handling', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('marks a session active from a V2 session.status busy event and routes it only to subscribed clients', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('active-a', clientA.callback, clientA.writeFrame, ['/r'])
    sseAggregator.addClient('active-b', clientB.callback, clientB.writeFrame, ['/other'])

    emitEvent({
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

    emitEvent({ id: 'evt_global', type: 'server.connected', data: {} })

    const expected = {
      directory: null,
      payload: { id: 'evt_global', created: 1, type: 'server.connected', data: {} },
    }
    expect(subscribed.frames.map(parseFrame)).toEqual([expected])
    expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('delivers the parsed event payload in a single data line', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('payload-a', client.callback, client.writeFrame, ['/r'])
    const event = eventOf({
      id: 'evt_raw',
      created: 7,
      type: 'session.idle',
      location: { directory: '/r' },
      data: { sessionID: 'ses_1', extra: { b: 2, a: 1 } },
    })

    ;(sseAggregator as unknown as { handleUpstreamEvent(event: V2Event): void }).handleUpstreamEvent(event)

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/r","payload":${JSON.stringify(event)}}\n\n`])
    expect(parseFrame(client.frames[0]!)).toEqual({ directory: '/r', payload: event })
    expect(client.frames[0]!.split('\n').filter(line => line.startsWith('data: '))).toHaveLength(1)
  })

  it('marks a session idle on session.idle and on terminal execution events', () => {
    emitEvent({ type: 'session.status', location: { directory: '/r' }, data: { sessionID: 'ses_1', status: { type: 'busy' } } })
    emitEvent({ type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_2' } })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_1', 'ses_2'] })

    emitEvent({ type: 'session.execution.succeeded', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_2'] })

    emitEvent({ type: 'session.execution.failed', location: { directory: '/r' }, data: { sessionID: 'ses_2', error: { type: 'unknown', message: 'boom' } } })
    emitEvent({ type: 'session.status', location: { directory: '/r' }, data: { sessionID: 'ses_3', status: { type: 'retry', attempt: 1, message: 'retrying', next: 1 } } })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_3'] })

    emitEvent({ type: 'session.idle', location: { directory: '/r' }, data: { sessionID: 'ses_3' } })
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('marks a session idle on session.execution.interrupted', () => {
    emitEvent({ type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    emitEvent({ type: 'session.execution.interrupted', location: { directory: '/r' }, data: { sessionID: 'ses_1', reason: 'shutdown' } })

    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('clears a busy session from the active set when it is deleted without going idle', () => {
    emitEvent({ type: 'session.status', location: { directory: '/r' }, data: { sessionID: 'ses_deleted', status: { type: 'busy' } } })

    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_deleted'] })

    emitEvent({ type: 'session.deleted', location: { directory: '/r' }, data: { sessionID: 'ses_deleted' } })

    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('records subagent sessions from session.created parentID and forgets deleted ones', () => {
    emitEvent({
      type: 'session.created',
      location: { directory: '/r' },
      data: { sessionID: 'ses_sub', parentID: 'ses_root', projectID: 'p', location: { directory: '/r' }, slug: 'sub', version: '2.0.15' },
    })

    expect(sseAggregator.isSubagentSession('ses_sub')).toBe(true)

    emitEvent({ type: 'session.deleted', location: { directory: '/r' }, data: { sessionID: 'ses_sub' } })

    expect(sseAggregator.isSubagentSession('ses_sub')).toBe(false)
  })
})

describe('SSEAggregator pending replay on connect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('replays pending permissions and forms from the V2 api per subscribed directory', async () => {
    sseAggregator.setOpenCodeClient(makeClient({
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
    sseAggregator.setOpenCodeClient(makeClient({
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
    sseAggregator.setOpenCodeClient(makeClient({
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
    sseAggregator.setOpenCodeClient({ api })

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
    sseAggregator.setOpenCodeClient({ api })

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
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('re-emits busy for a tracked session that is still running', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('status-1', client.callback, client.writeFrame, ['/repo/a'])

    emitEvent({ type: 'session.status', location: { directory: '/repo/a' }, data: { sessionID: 'ses-1', status: { type: 'busy' } } })

    sseAggregator.setOpenCodeClient(makeClient({ active: { 'ses-1': { type: 'running' } } }))

    await (sseAggregator as unknown as { replaySessionStatusesForTrackedDirectories(): Promise<void> }).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    const statuses = client.frames.map(parseFrame).filter(p => p.payload.type === 'session.status')
    expect(statuses).toHaveLength(2)
    expect(statuses.at(-1)?.payload.data).toEqual({ sessionID: 'ses-1', status: { type: 'busy' } })
  })

  it('emits idle for a tracked session that finished during the disconnect', async () => {
    const client = createCapturingClient()
    sseAggregator.addClient('status-2', client.callback, client.writeFrame, ['/repo/a'])

    emitEvent({ type: 'session.status', location: { directory: '/repo/a' }, data: { sessionID: 'ses-9', status: { type: 'busy' } } })

    sseAggregator.setOpenCodeClient(makeClient({ active: {} }))

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
    sseAggregator.setOpenCodeClient({ api })

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
    sseAggregator.setOpenCodeClient({ api })

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
    const fetcher = makeClient({
      permissions: { '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] },
    })
    sseAggregator.setOpenCodeClient(fetcher)
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
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('replays a scheduled directory that no browser client is subscribed to', async () => {
    sseAggregator.setOpenCodeClient(makeClient({
      active: { 'ses-sched': { type: 'running' } },
    }))
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-sched', directory: '/worktrees/run-1' },
    ])

    const seen: Array<{ directory: string | null; type: string; sessionID: string; status: string }> = []
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
    sseAggregator.setOpenCodeClient(makeClient({ active: {} }))
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
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
    sseAggregator.setResyncGate(() => true)
  })

  it('holds the resync while the gate is closed and broadcasts it once when released', () => {
    let gateOpen = false
    sseAggregator.setResyncGate(() => gateOpen)
    const client = createCapturingClient()
    sseAggregator.addClient('resync-gate', client.callback, client.writeFrame, ['/repo/a'])
    const resyncCount = () => client.events.filter(event => event.event === 'resync').length

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(true)
    expect(resyncCount()).toBe(0)

    gateOpen = true
    sseAggregator.releasePendingResync()
    sseAggregator.releasePendingResync()
    expect(resyncCount()).toBe(1)
  })

  it('does not broadcast on release when no resync is held', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('resync-none', client.callback, client.writeFrame, ['/repo/a'])

    sseAggregator.releasePendingResync()

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(0)
  })

  it('broadcasts a resync control event on the first and every later upstream connect', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('resync-1', client.callback, client.writeFrame, ['/repo/a'])

    const openUpstream = (sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen.bind(sseAggregator)
    openUpstream(false)
    openUpstream(true)

    const resyncs = client.events.filter(event => event.event === 'resync')
    expect(resyncs).toHaveLength(2)
    expect(JSON.parse(resyncs[0]!.data)).toEqual({ timestamp: expect.any(Number) })
    expect(client.frames).toHaveLength(0)
  })

  it('delivers resync to a client that subscribed before the upstream was ever connected', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('resync-2', client.callback, client.writeFrame, ['/repo/a'])

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(false)

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(1)
  })

  it('invokes onUpstreamConnected listeners on the first and every later upstream connect', () => {
    const listener = vi.fn()
    const unsubscribe = sseAggregator.onUpstreamConnected(listener)

    const openUpstream = (sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen.bind(sseAggregator)
    openUpstream(false)
    openUpstream(true)

    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    openUpstream(true)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing onUpstreamConnected listener from the others', () => {
    const throwing = vi.fn(() => { throw new Error('boom') })
    const healthy = vi.fn()
    sseAggregator.onUpstreamConnected(throwing)
    sseAggregator.onUpstreamConnected(healthy)

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(false)

    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})

describe('SSEAggregator directory-indexed broadcast', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('delivers only to clients subscribed to the event directory', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('index-a', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-b', clientB.callback, clientB.writeFrame, ['/b'])

    emitEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
  })

  it('does not encode a frame when no client subscribes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-c', clientA.callback, clientA.writeFrame, ['/a'])

    emitEvent({ type: 'session.idle', location: { directory: '/z' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(0)
  })

  it('removeClient deindexes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-d', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.removeClient('index-d')

    emitEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(0)
  })

  it('addDirectories then delivery', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-e', clientA.callback, clientA.writeFrame, [])
    sseAggregator.addDirectories('index-e', ['/a'])

    emitEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })

    expect(clientA.frames).toHaveLength(1)
  })

  it('replacing a client ID deindexes old directories', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    sseAggregator.addClient('index-f', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-f', clientB.callback, clientB.writeFrame, ['/b'])

    emitEvent({ type: 'session.idle', location: { directory: '/a' }, data: { sessionID: 'ses-1' } })
    expect(clientA.frames).toHaveLength(0)
    expect(clientB.frames).toHaveLength(0)

    emitEvent({ type: 'session.idle', location: { directory: '/b' }, data: { sessionID: 'ses-1' } })
    expect(clientB.frames).toHaveLength(1)
  })
})

describe('SSEAggregator directory-less session event routing', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('resolves a directory-less terminal event from the remembered directory for listeners, active sessions, and all clients', () => {
    const subscribed = createCapturingClient()
    const global = createCapturingClient()
    sseAggregator.addClient('resolved-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    sseAggregator.addClient('resolved-b', global.callback, global.writeFrame, [])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    sseAggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    emitEvent({ type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    expect(sseAggregator.getActiveSessions()).toEqual({ '/r': ['ses_1'] })

    emitEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    expect(seen).toEqual([
      { directory: '/r', type: 'session.execution.started', sessionID: 'ses_1' },
      { directory: '/r', type: 'session.execution.succeeded', sessionID: 'ses_1' },
    ])
    expect(sseAggregator.getActiveSessions()).toEqual({})

    expect(subscribed.frames.map(parseFrame)).toEqual([
      {
        directory: '/r',
        payload: { id: 'evt_1', created: 1, type: 'session.execution.started', location: { directory: '/r' }, data: { sessionID: 'ses_1' } },
      },
      {
        directory: null,
        payload: { id: 'evt_1', created: 1, type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } },
      },
    ])
    expect(global.frames.map(parseFrame)).toEqual([
      {
        directory: null,
        payload: { id: 'evt_1', created: 1, type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } },
      },
    ])
  })

  it('notifies listeners with a null directory for a directory-less event from an unknown session and still broadcasts it', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('unknown-a', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string }> = []
    sseAggregator.onEvent((directory, event) => { seen.push({ directory, type: event.type }) })

    emitEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_unknown' } })

    expect(seen).toEqual([{ directory: null, type: 'session.execution.succeeded' }])
    expect(sseAggregator.getActiveSessions()).toEqual({})
    expect(client.frames.map(parseFrame)).toEqual([
      {
        directory: null,
        payload: { id: 'evt_1', created: 1, type: 'session.execution.succeeded', data: { sessionID: 'ses_unknown' } },
      },
    ])
  })

  it('notifies listeners with a null directory for a session.deleted with no location and no remembered directory', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('deleted-unknown', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    sseAggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    emitEvent({ type: 'session.deleted', data: { sessionID: 'ses_unknown' } })

    expect(seen).toEqual([{ directory: null, type: 'session.deleted', sessionID: 'ses_unknown' }])
    expect(client.frames.map(parseFrame)).toEqual([
      {
        directory: null,
        payload: { id: 'evt_1', created: 1, type: 'session.deleted', data: { sessionID: 'ses_unknown' } },
      },
    ])
  })

  it('passes the resolved directory to listeners for a located session.deleted', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('deleted-located', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string }> = []
    sseAggregator.onEvent((directory, event) => { seen.push({ directory, type: event.type }) })

    emitEvent({ type: 'session.deleted', location: { directory: '/r' }, data: { sessionID: 'ses_located' } })

    expect(seen).toEqual([{ directory: '/r', type: 'session.deleted' }])
    expect(client.frames.map(parseFrame)).toEqual([
      {
        directory: '/r',
        payload: { id: 'evt_1', created: 1, type: 'session.deleted', location: { directory: '/r' }, data: { sessionID: 'ses_located' } },
      },
    ])
  })

  it('forgets the remembered directory when session.deleted arrives', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('deleted-a', client.callback, client.writeFrame, ['/r'])

    const seen: Array<string | null> = []
    sseAggregator.onEvent((directory) => { seen.push(directory) })

    emitEvent({ type: 'session.created', location: { directory: '/r' }, data: { sessionID: 'ses_del' } })
    emitEvent({ type: 'session.deleted', data: { sessionID: 'ses_del' } })

    seen.length = 0
    emitEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_del' } })

    expect(seen).toEqual([null])
    expect(sseAggregator.getActiveSessions()).toEqual({})
    expect(client.frames.map(parseFrame).at(-1)).toEqual({
      directory: null,
      payload: { id: 'evt_1', created: 1, type: 'session.execution.succeeded', data: { sessionID: 'ses_del' } },
    })
  })

  it('resolves a directory-less session.forked from the remembered parent directory and notifies listeners', () => {
    const subscribed = createCapturingClient()
    const global = createCapturingClient()
    sseAggregator.addClient('fork-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    sseAggregator.addClient('fork-b', global.callback, global.writeFrame, [])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    sseAggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    emitEvent({ type: 'session.created', location: { directory: '/r' }, data: { sessionID: 'ses_source' } })
    seen.length = 0

    emitEvent({ type: 'session.forked', data: { sessionID: 'ses_fork', parentID: 'ses_source', boundary: { messageID: 'msg_1' } } })

    expect(seen).toEqual([{ directory: '/r', type: 'session.forked', sessionID: 'ses_fork' }])

    const forkPayload = {
      id: 'evt_1',
      created: 1,
      type: 'session.forked',
      data: { sessionID: 'ses_fork', parentID: 'ses_source', boundary: { messageID: 'msg_1' } },
    }
    expect(subscribed.frames.map(parseFrame).at(-1)).toEqual({ directory: null, payload: forkPayload })
    expect(global.frames.map(parseFrame).at(-1)).toEqual({ directory: null, payload: forkPayload })

    seen.length = 0
    emitEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_fork' } })

    expect(seen).toEqual([{ directory: '/r', type: 'session.execution.succeeded', sessionID: 'ses_fork' }])
  })
})

describe('SSEAggregator server-aware event feed', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('notifies server listeners for local events with the local server id and resolved directory', () => {
    const seen: Array<{ serverId: string; directory: string | null; type: string }> = []
    sseAggregator.onServerEvent((serverId, directory, event) => {
      seen.push({ serverId, directory, type: event.type })
    })

    emitEvent({ type: 'session.created', location: { directory: '/r' }, data: { sessionID: 'ses_1' } })
    emitEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    expect(seen).toEqual([
      { serverId: 'local', directory: '/r', type: 'session.created' },
      { serverId: 'local', directory: '/r', type: 'session.execution.succeeded' },
    ])
  })

  it('delivers remote events with the remote server id without touching local active or subagent state', () => {
    const seen: Array<{ serverId: string; directory: string | null; type: string }> = []
    sseAggregator.onServerEvent((serverId, directory, event) => {
      seen.push({ serverId, directory, type: event.type })
    })

    sseAggregator.notifyServerEvent('srv_a', '/repo', {
      id: 'evt_remote',
      created: 1,
      type: 'session.created',
      location: { directory: '/repo' },
      data: { sessionID: 'ses_remote', parentID: 'ses_parent' },
    } as never)

    expect(seen).toEqual([{ serverId: 'srv_a', directory: '/repo', type: 'session.created' }])
    expect(sseAggregator.getActiveSessions()).toEqual({})
    expect(sseAggregator.isSubagentSession('ses_remote')).toBe(false)
    expect(sseAggregator.isSubagentSession('ses_remote', 'srv_a')).toBe(false)
  })

  it('isolates a throwing server event listener from the others', () => {
    const throwing = vi.fn(() => { throw new Error('boom') })
    const healthy = vi.fn()
    sseAggregator.onServerEvent(throwing)
    const unsubscribe = sseAggregator.onServerEvent(healthy)

    sseAggregator.notifyServerEvent('srv_a', '/repo', { type: 'session.idle', data: { sessionID: 'ses_1' } } as never)

    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)

    unsubscribe()
    sseAggregator.notifyServerEvent('srv_a', '/repo', { type: 'session.idle', data: { sessionID: 'ses_1' } } as never)
    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it('notifies server-connected listeners for the local upstream and for remote streams', () => {
    const seen: string[] = []
    sseAggregator.onServerConnected(serverId => { seen.push(serverId) })

    ;(sseAggregator as unknown as { handleUpstreamOpen(wasConnectedBefore: boolean): void }).handleUpstreamOpen(false)
    sseAggregator.notifyServerConnected('srv_a')

    expect(seen).toEqual(['local', 'srv_a'])
  })

  it('scopes session visibility to the active server id', () => {
    sseAggregator.addClient('viewed-local', () => {}, () => {}, ['/r'])
    sseAggregator.addClient('viewed-remote', () => {}, () => {}, ['srv_a|/r'])

    sseAggregator.setClientVisibility('viewed-local', true, 'ses_1')
    sseAggregator.setClientVisibility('viewed-remote', true, 'ses_2', 'srv_a')

    expect(sseAggregator.isSessionBeingViewed('ses_1')).toBe(true)
    expect(sseAggregator.isSessionBeingViewed('ses_1', 'srv_a')).toBe(false)
    expect(sseAggregator.isSessionBeingViewed('ses_2', 'srv_a')).toBe(true)
    expect(sseAggregator.isSessionBeingViewed('ses_2')).toBe(false)
  })

  it('clears the active server id when a client reports it is hidden', () => {
    sseAggregator.addClient('viewed-hidden', () => {}, () => {}, ['srv_a|/r'])
    sseAggregator.setClientVisibility('viewed-hidden', true, 'ses_1', 'srv_a')
    sseAggregator.setClientVisibility('viewed-hidden', false)

    expect(sseAggregator.isSessionBeingViewed('ses_1', 'srv_a')).toBe(false)
  })
})

describe('SSEAggregator location-scoped catalog event broadcast', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it.each(['command.updated', 'agent.updated', 'skill.updated', 'model.updated', 'provider.updated', 'integration.updated'])(
    'broadcasts a location-scoped %s catalog event to every client without leaking other location-scoped events',
    (type) => {
      const subscribed = createCapturingClient()
      const unsubscribed = createCapturingClient()
      sseAggregator.addClient('catalog-a', subscribed.callback, subscribed.writeFrame, ['/repo-a'])
      sseAggregator.addClient('catalog-b', unsubscribed.callback, unsubscribed.writeFrame, [])

      const seen: Array<{ directory: string | null; type: string }> = []
      sseAggregator.onEvent((directory, event) => {
        seen.push({ directory, type: event.type })
      })

      emitEvent({ id: 'evt_catalog', type, location: { directory: '/repo-c' }, data: {} })

      const expected = {
        directory: null,
        payload: { id: 'evt_catalog', created: 1, type, location: { directory: '/repo-c' }, data: {} },
      }
      expect(subscribed.frames.map(parseFrame)).toEqual([expected])
      expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
      expect(seen).toEqual([{ directory: '/repo-c', type }])

      emitEvent({
        id: 'evt_status',
        type: 'session.status',
        location: { directory: '/repo-c' },
        data: { sessionID: 'ses-1', status: { type: 'busy' } },
      })

      expect(subscribed.frames).toHaveLength(1)
      expect(unsubscribed.frames).toHaveLength(1)
    },
  )
})

interface ControlledEventStream {
  iterable: AsyncIterable<V2Event>
  signal: AbortSignal
  push: (event: V2Event) => void
  end: () => void
}

function createControlledEventStream(): ControlledEventStream {
  const queue: V2Event[] = []
  let finished = false
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
      next.addEventListener('abort', wake, { once: true })
    },
    push: (event) => {
      queue.push(event)
      wake()
    },
    end: () => {
      finished = true
      wake()
    },
  } as ControlledEventStream
}

function makeStreamingApi(active: Record<string, { type: 'running' }> = {}) {
  const subscriptions: ControlledEventStream[] = []
  const api = {
    ...makeApi({ active }),
    event: {
      subscribe: (options: { signal?: AbortSignal }) => {
        const stream = createControlledEventStream()
        stream.signal = options.signal!
        subscriptions.push(stream)
        return stream.iterable
      },
    },
  } as unknown as OpenCodeApi
  return { api, subscriptions }
}

describe('SSEAggregator upstream transport', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('streams through the OpenCode client host override and resolved password', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const fetchFn = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ))
    const client = new FetchOpenCodeClient({
      baseUrl: getOpenCodeUpstreamBaseUrl('10.20.30.40'),
      basicAuth: null,
      passwordResolver: () => 'resolved-secret',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    const captured = createCapturingClient()
    sseAggregator.addClient('transport-a', captured.callback, captured.writeFrame, ['/repo'])
    sseAggregator.setOpenCodeClient(client)
    sseAggregator.start()
    await flushReplay()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('http://10.20.30.40:5551/api/event')
    expect(new Headers(init.headers).get('Authorization')).toBe(buildOpenCodeBasicAuth('resolved-secret'))

    const encoder = new TextEncoder()
    streamController!.enqueue(encoder.encode(`data: ${JSON.stringify(eventOf({ type: 'server.connected', data: {} }))}\n\n`))
    const busy = eventOf({
      type: 'session.status',
      location: { directory: '/repo' },
      data: { sessionID: 'ses-1', status: { type: 'busy' } },
    })
    streamController!.enqueue(encoder.encode(`data: ${JSON.stringify(busy)}\n\n`))
    await flushReplay()

    expect(captured.events.filter(event => event.event === 'resync')).toHaveLength(1)
    expect(captured.frames.map(parseFrame).filter(frame => frame.payload.type === 'session.status')).toEqual([
      { directory: '/repo', payload: busy },
    ])

    streamController!.close()
    sseAggregator.shutdown()
  })
})

describe('SSEAggregator upstream reconnection', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setOpenCodeClient(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('reconnects after the stream ends, broadcasting resync and replaying tracked statuses', async () => {
    vi.useFakeTimers()
    try {
      const { api, subscriptions } = makeStreamingApi({ 'ses-1': { type: 'running' } })
      const client = createCapturingClient()
      sseAggregator.addClient('reconnect-a', client.callback, client.writeFrame, ['/repo/a'])
      sseAggregator.setOpenCodeClient({ api })
      sseAggregator.start()

      expect(subscriptions).toHaveLength(1)
      subscriptions[0]!.push(eventOf({ type: 'server.connected', data: {} }))
      subscriptions[0]!.push(eventOf({
        type: 'session.status',
        location: { directory: '/repo/a' },
        data: { sessionID: 'ses-1', status: { type: 'busy' } },
      }))
      await flushReplay()

      expect(client.events.filter(event => event.event === 'resync')).toHaveLength(1)
      expect(sseAggregator.getActiveSessions()).toEqual({ '/repo/a': ['ses-1'] })

      subscriptions[0]!.end()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)

      expect(subscriptions).toHaveLength(2)
      subscriptions[1]!.push(eventOf({ type: 'server.connected', data: {} }))
      await flushReplay()

      expect(client.events.filter(event => event.event === 'resync')).toHaveLength(2)
      expect(api.session.active).toHaveBeenCalledTimes(1)
      const statuses = client.frames.map(parseFrame).filter(frame => frame.payload.type === 'session.status')
      expect(statuses.at(-1)?.payload.data).toEqual({ sessionID: 'ses-1', status: { type: 'busy' } })
    } finally {
      vi.useRealTimers()
    }
  })
})
