import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest'
import { z } from 'zod'
import {
  buildOpenCodeBasicAuth,
  createOpenCodeApi,
  sessionIDFromEvent,
  type OpenCodeApi,
  type SessionStatus,
  type V2Event,
} from '@opencode-manager/shared/opencode'
import { JsonValueSchema } from '@opencode-manager/shared/utils'
import { createSSEAggregator, type SSEAggregator } from '../../src/services/sse-aggregator'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { getOpenCodeUpstreamBaseUrl } from '../../src/services/opencode/upstream'
import { createFetchStub } from '../helpers/fetch-stub'
import { sessionInfo } from '../helpers/stub-opencode-client'

interface CapturedEvent {
  event: string
  data: string
}

interface CapturedClient {
  events: CapturedEvent[]
  frames: string[]
  callback: (event: string, data: string) => void
  writeFrame: (frame: Uint8Array) => void
}

function createCapturingClient(): CapturedClient {
  const events: CapturedEvent[] = []
  const frames: string[] = []
  const decoder = new TextDecoder()
  return {
    events,
    frames,
    callback: (event, data) => { events.push({ event, data }) },
    writeFrame: (frame) => { frames.push(decoder.decode(frame)) },
  }
}

const EnvelopeSchema = z.object({
  directory: z.string().nullable(),
  payload: z.looseObject({ id: z.string(), created: z.number(), type: z.string() }),
})

const StatusEnvelopeSchema = z.object({
  directory: z.string().nullable(),
  payload: z.object({
    id: z.string(),
    created: z.number(),
    type: z.string(),
    data: z.object({ sessionID: z.string(), status: z.object({ type: z.string() }) }),
  }),
})

const PermissionReplaySchema = z.object({
  directory: z.string(),
  payload: z.object({
    id: z.string(),
    created: z.number(),
    type: z.string(),
    location: z.object({ directory: z.string() }),
    data: z.object({ id: z.string(), sessionID: z.string(), action: z.string(), resources: z.array(z.string()) }),
  }),
})

const FormReplaySchema = z.object({
  directory: z.string(),
  payload: z.object({
    id: z.string(),
    created: z.number(),
    type: z.string(),
    location: z.object({ directory: z.string() }),
    data: z.object({
      form: z.object({ id: z.string(), sessionID: z.string(), title: z.string(), fields: z.array(JsonValueSchema) }),
    }),
  }),
})

const ResyncSchema = z.object({ timestamp: z.number() })

function frameJson(frame: string) {
  return JSON.parse(frame.replace(/^event: message\ndata: /, '').trim())
}

function parseFrame(frame: string) {
  return EnvelopeSchema.parse(frameJson(frame))
}

function statusFrames(client: CapturedClient) {
  const statuses: Array<z.infer<typeof StatusEnvelopeSchema>> = []
  for (const frame of client.frames) {
    if (parseFrame(frame).payload.type !== 'session.status') continue
    statuses.push(StatusEnvelopeSchema.parse(frameJson(frame)))
  }
  return statuses
}

function permissionReplays(client: CapturedClient) {
  const replays: Array<z.infer<typeof PermissionReplaySchema>> = []
  for (const event of client.events) {
    if (parseFrame(event.data).payload.type !== 'permission.asked') continue
    replays.push(PermissionReplaySchema.parse(JSON.parse(event.data)))
  }
  return replays
}

function formReplays(client: CapturedClient) {
  const replays: Array<z.infer<typeof FormReplaySchema>> = []
  for (const event of client.events) {
    if (parseFrame(event.data).payload.type !== 'form.created') continue
    replays.push(FormReplaySchema.parse(JSON.parse(event.data)))
  }
  return replays
}

type PermissionRequestInfo = Awaited<ReturnType<OpenCodeApi['permission']['request']['list']>>['data'][number]
type OpenCodeForm = Awaited<ReturnType<OpenCodeApi['form']['list']>>['data'][number]
type ActiveSession = Awaited<ReturnType<OpenCodeApi['session']['active']>>[string]

interface ApiFixture {
  permissions?: Record<string, PermissionRequestInfo[]>
  forms?: Record<string, OpenCodeForm[]>
  active?: Record<string, ActiveSession>
  sessions?: Record<string, string>
}

interface Upstream {
  api: OpenCodeApi
  permissionList: Mock<OpenCodeApi['permission']['request']['list']>
  formList: Mock<OpenCodeApi['form']['list']>
  activeSessions: Mock<OpenCodeApi['session']['active']>
  getSession: Mock<OpenCodeApi['session']['get']>
  push: (event: V2Event) => void
  end: () => void
  fetchCalls: () => number
}

function createUpstream(fixture: ApiFixture = {}): Upstream {
  const permissionList = vi.fn<OpenCodeApi['permission']['request']['list']>(async (input) => ({
    location: { directory: input?.location?.directory ?? '' },
    data: fixture.permissions?.[input?.location?.directory ?? ''] ?? [],
  }))
  const formList = vi.fn<OpenCodeApi['form']['list']>(async (input) => ({
    location: { directory: input?.location?.directory ?? '' },
    data: fixture.forms?.[input?.location?.directory ?? ''] ?? [],
  }))
  const activeSessions = vi.fn<OpenCodeApi['session']['active']>(async () => fixture.active ?? {})
  const getSession = vi.fn<OpenCodeApi['session']['get']>(async ({ sessionID }) => {
    const directory = fixture.sessions?.[sessionID]
    if (directory === undefined) throw new Error(`unknown session: ${sessionID}`)
    return sessionInfo({ id: sessionID, location: { directory } })
  })

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let calls = 0
  const encoder = new TextEncoder()
  const fetchStub = createFetchStub(async () => {
    calls += 1
    return new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  const api = createOpenCodeApi({ baseUrl: 'http://opencode.stub', fetch: fetchStub })
  api.permission.request.list = permissionList
  api.form.list = formList
  api.session.active = activeSessions
  api.session.get = getSession

  return {
    api,
    permissionList,
    formList,
    activeSessions,
    getSession,
    push: (event) => {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    end: () => {
      controller?.close()
      controller = null
    },
    fetchCalls: () => calls,
  }
}

interface EventMeta {
  id?: string
  created?: number
}

type StatusEvent = Extract<V2Event, { type: 'session.status' }>
type IdleEvent = Extract<V2Event, { type: 'session.idle' }>
type ExecutionStartedEvent = Extract<V2Event, { type: 'session.execution.started' }>
type ExecutionSucceededEvent = Extract<V2Event, { type: 'session.execution.succeeded' }>
type ExecutionFailedEvent = Extract<V2Event, { type: 'session.execution.failed' }>
type ExecutionInterruptedEvent = Extract<V2Event, { type: 'session.execution.interrupted' }>
type DeletedEvent = Extract<V2Event, { type: 'session.deleted' }>
type CreatedEvent = Extract<V2Event, { type: 'session.created' }>
type ForkedEvent = Extract<V2Event, { type: 'session.forked' }>
type ServerConnectedEvent = Extract<V2Event, { type: 'server.connected' }>
type CatalogEventType = 'command.updated' | 'agent.updated' | 'skill.updated' | 'model.updated' | 'provider.updated' | 'integration.updated'

function meta(input: EventMeta = {}) {
  return { id: input.id ?? 'evt_1', created: input.created ?? 1 }
}

function statusEvent(directory: string | null, sessionID: string, status: SessionStatus, eventMeta: EventMeta = {}): StatusEvent {
  const event: StatusEvent = {
    ...meta(eventMeta),
    type: 'session.status',
    data: { sessionID, status },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function idleEvent(directory: string | null, sessionID: string, eventMeta: EventMeta = {}): IdleEvent {
  const event: IdleEvent = { ...meta(eventMeta), type: 'session.idle', data: { sessionID } }
  if (directory !== null) event.location = { directory }
  return event
}

function executionStartedEvent(directory: string | null, sessionID: string): ExecutionStartedEvent {
  const event: ExecutionStartedEvent = {
    ...meta(),
    type: 'session.execution.started',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function executionSucceededEvent(directory: string | null, sessionID: string): ExecutionSucceededEvent {
  const event: ExecutionSucceededEvent = {
    ...meta(),
    type: 'session.execution.succeeded',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function executionFailedEvent(directory: string | null, sessionID: string): ExecutionFailedEvent {
  const event: ExecutionFailedEvent = {
    ...meta(),
    type: 'session.execution.failed',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, error: { type: 'unknown', message: 'boom' } },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function executionInterruptedEvent(directory: string | null, sessionID: string): ExecutionInterruptedEvent {
  const event: ExecutionInterruptedEvent = {
    ...meta(),
    type: 'session.execution.interrupted',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, reason: 'shutdown' },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function deletedEvent(directory: string | null, sessionID: string): DeletedEvent {
  const event: DeletedEvent = {
    ...meta(),
    type: 'session.deleted',
    durable: { aggregateID: sessionID, seq: 1, version: 2 },
    data: { sessionID },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function createdEvent(directory: string | null, sessionID: string, parentID?: string): CreatedEvent {
  const data: CreatedEvent['data'] = {
    sessionID,
    projectID: 'p',
    location: { directory: directory ?? '' },
    slug: 'slug',
    version: '2.0.15',
  }
  if (parentID !== undefined) data.parentID = parentID
  const event: CreatedEvent = {
    ...meta(),
    type: 'session.created',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data,
  }
  if (directory !== null) event.location = { directory }
  return event
}

function forkedEvent(directory: string | null, sessionID: string, parentID: string): ForkedEvent {
  const event: ForkedEvent = {
    ...meta(),
    type: 'session.forked',
    durable: { aggregateID: sessionID, seq: 1, version: 2 },
    data: { sessionID, parentID, boundary: { type: 'before', messageID: 'msg_1' } },
  }
  if (directory !== null) event.location = { directory }
  return event
}

function serverConnectedEvent(): ServerConnectedEvent {
  return { ...meta(), type: 'server.connected', data: {} }
}

const CATALOG_EVENTS = {
  'command.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'command.updated', location: { directory }, data: {} }),
  'agent.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'agent.updated', location: { directory }, data: {} }),
  'skill.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'skill.updated', location: { directory }, data: {} }),
  'model.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'model.updated', location: { directory }, data: {} }),
  'provider.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'provider.updated', location: { directory }, data: {} }),
  'integration.updated': (directory) => ({ id: 'evt_catalog', created: 1, type: 'integration.updated', location: { directory }, data: {} }),
} satisfies Record<CatalogEventType, (directory: string) => V2Event>

interface RunningAggregator {
  upstream: Upstream
  emit: (event: V2Event) => Promise<void>
}

let aggregator: SSEAggregator

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve()
  }
}

async function startAggregator(fixture: ApiFixture = {}): Promise<RunningAggregator> {
  const upstream = createUpstream(fixture)
  aggregator.setOpenCodeClient({ api: upstream.api })
  aggregator.start()
  await settle()
  return {
    upstream,
    emit: async (event) => {
      upstream.push(event)
      await settle()
    },
  }
}

async function reconnect(running: RunningAggregator): Promise<void> {
  running.upstream.end()
  await vi.advanceTimersByTimeAsync(60_000)
  await settle()
}

describe('SSEAggregator V2 event handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('marks a session active from a V2 session.status busy event and routes it only to subscribed clients', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    aggregator.addClient('active-a', clientA.callback, clientA.writeFrame, ['/r'])
    aggregator.addClient('active-b', clientB.callback, clientB.writeFrame, ['/other'])
    const event = statusEvent('/r', 'ses_1', { type: 'busy' })

    await running.emit(event)

    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_1'] })
    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
    expect(parseFrame(clientA.frames[0]!)).toEqual({ directory: '/r', payload: event })
  })

  it('delivers events without a location directory to every connected client with a null directory', async () => {
    const running = await startAggregator()
    const subscribed = createCapturingClient()
    const unsubscribed = createCapturingClient()
    aggregator.addClient('global-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    aggregator.addClient('global-b', unsubscribed.callback, unsubscribed.writeFrame, [])
    const event = serverConnectedEvent()

    await running.emit(event)

    const expected = { directory: null, payload: event }
    expect(subscribed.frames.map(parseFrame)).toEqual([expected])
    expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
    expect(aggregator.getActiveSessions()).toEqual({})
  })

  it('delivers the parsed event payload in a single data line', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('payload-a', client.callback, client.writeFrame, ['/r'])
    const event = idleEvent('/r', 'ses_1', { id: 'evt_raw', created: 7 })

    await running.emit(event)

    expect(client.frames).toEqual([`event: message\ndata: {"directory":"/r","payload":${JSON.stringify(event)}}\n\n`])
    expect(parseFrame(client.frames[0]!)).toEqual({ directory: '/r', payload: event })
    expect(client.frames[0]!.split('\n').filter(line => line.startsWith('data: '))).toHaveLength(1)
  })

  it('marks a session idle on session.idle and on terminal execution events', async () => {
    const running = await startAggregator()

    await running.emit(statusEvent('/r', 'ses_1', { type: 'busy' }))
    await running.emit(executionStartedEvent('/r', 'ses_2'))

    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_1', 'ses_2'] })

    await running.emit(executionSucceededEvent('/r', 'ses_1'))
    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_2'] })

    await running.emit(executionFailedEvent('/r', 'ses_2'))
    await running.emit(statusEvent('/r', 'ses_3', { type: 'retry', attempt: 1, message: 'retrying', next: 1 }))

    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_3'] })

    await running.emit(idleEvent('/r', 'ses_3'))
    expect(aggregator.getActiveSessions()).toEqual({})
  })

  it('marks a session idle on session.execution.interrupted', async () => {
    const running = await startAggregator()

    await running.emit(executionStartedEvent('/r', 'ses_1'))
    await running.emit(executionInterruptedEvent('/r', 'ses_1'))

    expect(aggregator.getActiveSessions()).toEqual({})
  })

  it('clears a busy session from the active set when it is deleted without going idle', async () => {
    const running = await startAggregator()

    await running.emit(statusEvent('/r', 'ses_deleted', { type: 'busy' }))

    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_deleted'] })

    await running.emit(deletedEvent('/r', 'ses_deleted'))

    expect(aggregator.getActiveSessions()).toEqual({})
  })

  it('records subagent sessions from session.created parentID and forgets deleted ones', async () => {
    const running = await startAggregator()

    await running.emit(createdEvent('/r', 'ses_sub', 'ses_root'))

    expect(aggregator.isSubagentSession('ses_sub')).toBe(true)

    await running.emit(deletedEvent('/r', 'ses_sub'))

    expect(aggregator.isSubagentSession('ses_sub')).toBe(false)
  })
})

describe('SSEAggregator pending replay on connect', () => {
  beforeEach(() => {
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
  })

  it('replays pending permissions and forms from the V2 api per subscribed directory', async () => {
    const upstream = createUpstream({
      permissions: {
        '/repo/a': [
          { id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['rm -rf node_modules'] },
          { id: 'perm-2', sessionID: 'ses-a', action: 'edit', resources: ['src/index.ts'] },
        ],
        '/repo/b': [{ id: 'perm-3', sessionID: 'ses-b', action: 'read', resources: ['README.md'] }],
      },
      forms: {
        '/repo/a': [{ id: 'form-1', sessionID: 'ses-a', title: 'Deploy to prod?', fields: [{ key: 'note', type: 'string' }] }],
      },
    })
    aggregator.setOpenCodeClient({ api: upstream.api })

    const client = createCapturingClient()
    aggregator.addClient('client-1', client.callback, client.writeFrame, ['/repo/a', '/repo/b'])

    await settle()

    expect(client.events).toHaveLength(4)

    const permissionsA = permissionReplays(client).filter((envelope) => envelope.directory === '/repo/a')
    expect(permissionsA.map((envelope) => envelope.payload.data.id)).toEqual(['perm-1', 'perm-2'])
    expect(permissionsA[0]?.payload.id).toMatch(/^ocm_replay_/)
    expect(permissionsA[0]?.payload.location).toEqual({ directory: '/repo/a' })
    expect(permissionsA[0]?.payload.data).toEqual({
      id: 'perm-1',
      sessionID: 'ses-a',
      action: 'shell',
      resources: ['rm -rf node_modules'],
    })

    const formsA = formReplays(client).filter((envelope) => envelope.directory === '/repo/a')
    expect(formsA).toHaveLength(1)
    expect(formsA[0]?.payload.data).toEqual({
      form: { id: 'form-1', sessionID: 'ses-a', title: 'Deploy to prod?', fields: [{ key: 'note', type: 'string' }] },
    })

    expect(permissionReplays(client).filter((envelope) => envelope.directory === '/repo/b').map((envelope) => envelope.payload.data.id)).toEqual(['perm-3'])
    expect(formReplays(client).filter((envelope) => envelope.directory === '/repo/b')).toHaveLength(0)
  })

  it('does not replay when no api is configured', async () => {
    const client = createCapturingClient()
    aggregator.addClient('client-2', client.callback, client.writeFrame, ['/repo/a'])

    await settle()

    expect(client.events).toHaveLength(0)
  })

  it('does not replay to other clients', async () => {
    const upstream = createUpstream({
      permissions: { '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] },
    })
    aggregator.setOpenCodeClient({ api: upstream.api })

    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    aggregator.addClient('a', clientA.callback, clientA.writeFrame, ['/repo/a'])
    aggregator.addClient('b', clientB.callback, clientB.writeFrame, [])

    await settle()

    expect(clientA.events).toHaveLength(1)
    expect(clientB.events).toHaveLength(0)
  })

  it('replays only newly added directories on addDirectories', async () => {
    const upstream = createUpstream({
      permissions: {
        '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }],
        '/repo/b': [{ id: 'perm-2', sessionID: 'ses-b', action: 'shell', resources: ['ls'] }],
      },
    })
    aggregator.setOpenCodeClient({ api: upstream.api })

    const client = createCapturingClient()
    aggregator.addClient('client-3', client.callback, client.writeFrame, ['/repo/a'])
    await settle()

    const initialCount = client.events.length
    expect(initialCount).toBe(1)

    aggregator.addDirectories('client-3', ['/repo/a', '/repo/b'])
    await settle()

    const replayed = permissionReplays(client).slice(1)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.directory).toBe('/repo/b')
    expect(replayed[0]?.payload.data.id).toBe('perm-2')
  })

  it('survives upstream fetch failures for one directory and still replays the others', async () => {
    const upstream = createUpstream({
      permissions: { '/repo/ok': [{ id: 'perm-ok', sessionID: 'ses-ok', action: 'shell', resources: ['ls'] }] },
    })
    upstream.permissionList.mockImplementation(async (input) => {
      if (input?.location?.directory === '/repo/broken') throw new Error('upstream down')
      return { location: { directory: input?.location?.directory ?? '' }, data: [{ id: 'perm-ok', sessionID: 'ses-ok', action: 'shell', resources: ['ls'] }] }
    })
    aggregator.setOpenCodeClient({ api: upstream.api })

    const client = createCapturingClient()
    aggregator.addClient('client-4', client.callback, client.writeFrame, ['/repo/broken', '/repo/ok'])
    await settle()

    const replayed = permissionReplays(client)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.directory).toBe('/repo/ok')
    expect(replayed[0]?.payload.data.id).toBe('perm-ok')
  })

  it('does not deliver replay events to a client that no longer subscribes to that directory', async () => {
    const upstream = createUpstream()
    let resolvePermissions: (value: Awaited<ReturnType<OpenCodeApi['permission']['request']['list']>>) => void = () => undefined
    upstream.permissionList.mockImplementation(() => new Promise((resolve) => {
      resolvePermissions = resolve
    }))
    aggregator.setOpenCodeClient({ api: upstream.api })

    const client = createCapturingClient()
    aggregator.addClient('client-5', client.callback, client.writeFrame, ['/repo/a'])

    aggregator.removeDirectories('client-5', ['/repo/a'])
    resolvePermissions({ location: { directory: '/repo/a' }, data: [{ id: 'late', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] })

    await settle()

    expect(client.events).toHaveLength(0)
  })
})

describe('SSEAggregator session status replay on upstream reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('re-emits busy for a tracked session that is still running', async () => {
    const running = await startAggregator({ active: { 'ses-1': { type: 'running' } } })
    const client = createCapturingClient()
    aggregator.addClient('status-1', client.callback, client.writeFrame, ['/repo/a'])

    await running.emit(statusEvent('/repo/a', 'ses-1', { type: 'busy' }))
    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    const statuses = statusFrames(client)
    expect(statuses).toHaveLength(2)
    expect(statuses.at(-1)?.payload.data).toEqual({ sessionID: 'ses-1', status: { type: 'busy' } })
  })

  it('emits idle for a tracked session that finished during the disconnect', async () => {
    const running = await startAggregator({ active: {} })
    const client = createCapturingClient()
    aggregator.addClient('status-2', client.callback, client.writeFrame, ['/repo/a'])

    await running.emit(statusEvent('/repo/a', 'ses-9', { type: 'busy' }))
    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    const idle = statusFrames(client).filter((frame) => frame.payload.data.status.type === 'idle')
    expect(idle).toHaveLength(1)
    expect(idle[0]?.payload.data).toEqual({ sessionID: 'ses-9', status: { type: 'idle' } })
    expect(aggregator.getActiveSessions()).toEqual({})
  })

  it('resolves the directory for a running session that is not tracked', async () => {
    const running = await startAggregator({
      active: { 'ses-new': { type: 'running' } },
      sessions: { 'ses-new': '/repo/new' },
    })
    const client = createCapturingClient()
    aggregator.addClient('status-3', client.callback, client.writeFrame, ['/repo/new'])

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(running.upstream.getSession).toHaveBeenCalledWith({ sessionID: 'ses-new' })
    const statuses = statusFrames(client)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.directory).toBe('/repo/new')
    expect(statuses[0]?.payload.data).toEqual({ sessionID: 'ses-new', status: { type: 'busy' } })
  })

  it('resolves untracked running session directories concurrently', async () => {
    const running = await startAggregator({ active: { 'ses-x': { type: 'running' }, 'ses-y': { type: 'running' } } })
    const pending: Array<() => void> = []
    running.upstream.getSession.mockImplementation((input) => new Promise((resolve) => {
      pending.push(() => resolve(sessionInfo({ id: input.sessionID, location: { directory: `/repo/${input.sessionID}` } })))
    }))
    const client = createCapturingClient()
    aggregator.addClient('status-5', client.callback, client.writeFrame, ['/repo/ses-x', '/repo/ses-y'])

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    running.upstream.push(serverConnectedEvent())
    await settle()

    expect(running.upstream.getSession).toHaveBeenCalledTimes(2)
    pending.forEach((resolve) => resolve())
    await settle()

    const directories = statusFrames(client).map((frame) => frame.directory).sort()
    expect(directories).toEqual(['/repo/ses-x', '/repo/ses-y'])
  })

  it('does not replay pending actions to already connected clients on upstream reconnect', async () => {
    const running = await startAggregator({
      permissions: { '/repo/a': [{ id: 'perm-1', sessionID: 'ses-a', action: 'shell', resources: ['ls'] }] },
    })
    const client = createCapturingClient()
    aggregator.addClient('status-6', client.callback, client.writeFrame, ['/repo/a'])
    await settle()
    running.upstream.permissionList.mockClear()
    running.upstream.formList.mockClear()

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(running.upstream.permissionList).not.toHaveBeenCalled()
    expect(running.upstream.formList).not.toHaveBeenCalled()
    expect(running.upstream.activeSessions).toHaveBeenCalledTimes(1)
    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(2)
    expect(client.events.filter(event => event.event === 'message')).toHaveLength(1)
  })
})

describe('SSEAggregator scheduled session replay without a connected client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('replays a scheduled directory that no browser client is subscribed to', async () => {
    aggregator.setScheduledSessionsResolver(() => [{ sessionID: 'ses-sched', directory: '/worktrees/run-1' }])
    const running = await startAggregator({ active: { 'ses-sched': { type: 'running' } } })

    const seen: Array<{ directory: string | null; type: string; sessionID: string; status: string }> = []
    aggregator.onEvent((directory, event) => {
      if (event.type !== 'session.status') return
      seen.push({ directory, type: event.type, sessionID: event.data.sessionID, status: event.data.status.type })
    })

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(seen).toEqual([
      { directory: '/worktrees/run-1', type: 'session.status', sessionID: 'ses-sched', status: 'busy' },
    ])
  })

  it('emits idle for a scheduled session that finished while the stream was down and was never marked active', async () => {
    aggregator.setScheduledSessionsResolver(() => [{ sessionID: 'ses-finished', directory: '/worktrees/run-2' }])
    const running = await startAggregator({ active: {} })

    const idle: string[] = []
    aggregator.onEvent((_directory, event) => {
      if (event.type === 'session.status' && event.data.status.type === 'idle') {
        idle.push(event.data.sessionID)
      }
    })

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(idle).toEqual(['ses-finished'])
  })
})

describe('SSEAggregator upstream resynchronization signal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
    aggregator.setResyncGate(() => true)
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('holds the resync while the gate is closed and broadcasts it once when released', async () => {
    let gateOpen = false
    aggregator.setResyncGate(() => gateOpen)
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('resync-gate', client.callback, client.writeFrame, ['/repo/a'])
    const resyncCount = () => client.events.filter(event => event.event === 'resync').length

    await running.emit(serverConnectedEvent())
    expect(resyncCount()).toBe(0)

    gateOpen = true
    aggregator.releasePendingResync()
    aggregator.releasePendingResync()
    expect(resyncCount()).toBe(1)
  })

  it('does not broadcast on release when no resync is held', () => {
    const client = createCapturingClient()
    aggregator.addClient('resync-none', client.callback, client.writeFrame, ['/repo/a'])

    aggregator.releasePendingResync()

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(0)
  })

  it('broadcasts a resync control event on the first and every later upstream connect', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('resync-1', client.callback, client.writeFrame, ['/repo/a'])

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    const resyncs = client.events.filter(event => event.event === 'resync')
    expect(resyncs).toHaveLength(2)
    expect(ResyncSchema.parse(JSON.parse(resyncs[0]!.data))).toEqual({ timestamp: expect.any(Number) })
    expect(client.events.filter(event => event.event === 'message')).toHaveLength(0)
  })

  it('invokes onUpstreamConnected listeners on the first and every later upstream connect', async () => {
    const running = await startAggregator()
    const listener = vi.fn()
    const unsubscribe = aggregator.onUpstreamConnected(listener)

    await running.emit(serverConnectedEvent())
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    await reconnect(running)
    await running.emit(serverConnectedEvent())

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing onUpstreamConnected listener from the others', async () => {
    const running = await startAggregator()
    const throwing = vi.fn(() => { throw new Error('boom') })
    const healthy = vi.fn()
    aggregator.onUpstreamConnected(throwing)
    aggregator.onUpstreamConnected(healthy)

    await running.emit(serverConnectedEvent())

    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})

describe('SSEAggregator directory-indexed broadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('delivers only to clients subscribed to the event directory', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    aggregator.addClient('index-a', clientA.callback, clientA.writeFrame, ['/a'])
    aggregator.addClient('index-b', clientB.callback, clientB.writeFrame, ['/b'])

    await running.emit(idleEvent('/a', 'ses-1'))

    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
  })

  it('does not encode a frame when no client subscribes', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    aggregator.addClient('index-c', clientA.callback, clientA.writeFrame, ['/a'])

    await running.emit(idleEvent('/z', 'ses-1'))

    expect(clientA.frames).toHaveLength(0)
  })

  it('removeClient deindexes', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    aggregator.addClient('index-d', clientA.callback, clientA.writeFrame, ['/a'])
    aggregator.removeClient('index-d')

    await running.emit(idleEvent('/a', 'ses-1'))

    expect(clientA.frames).toHaveLength(0)
  })

  it('addDirectories then delivery', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    aggregator.addClient('index-e', clientA.callback, clientA.writeFrame, [])
    aggregator.addDirectories('index-e', ['/a'])

    await running.emit(idleEvent('/a', 'ses-1'))

    expect(clientA.frames).toHaveLength(1)
  })

  it('replacing a client ID deindexes old directories', async () => {
    const running = await startAggregator()
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    aggregator.addClient('index-f', clientA.callback, clientA.writeFrame, ['/a'])
    aggregator.addClient('index-f', clientB.callback, clientB.writeFrame, ['/b'])

    await running.emit(idleEvent('/a', 'ses-1'))
    expect(clientA.frames).toHaveLength(0)
    expect(clientB.frames).toHaveLength(0)

    await running.emit(idleEvent('/b', 'ses-1'))
    expect(clientB.frames).toHaveLength(1)
  })
})

describe('SSEAggregator directory-less session event routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('resolves a directory-less terminal event from the remembered directory for listeners, active sessions, and all clients', async () => {
    const running = await startAggregator()
    const subscribed = createCapturingClient()
    const global = createCapturingClient()
    aggregator.addClient('resolved-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    aggregator.addClient('resolved-b', global.callback, global.writeFrame, [])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    aggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    const started = executionStartedEvent('/r', 'ses_1')
    const succeeded = executionSucceededEvent(null, 'ses_1')
    await running.emit(started)
    expect(aggregator.getActiveSessions()).toEqual({ '/r': ['ses_1'] })

    await running.emit(succeeded)

    expect(seen).toEqual([
      { directory: '/r', type: 'session.execution.started', sessionID: 'ses_1' },
      { directory: '/r', type: 'session.execution.succeeded', sessionID: 'ses_1' },
    ])
    expect(aggregator.getActiveSessions()).toEqual({})

    expect(subscribed.frames.map(parseFrame)).toEqual([
      { directory: '/r', payload: started },
      { directory: null, payload: succeeded },
    ])
    expect(global.frames.map(parseFrame)).toEqual([{ directory: null, payload: succeeded }])
  })

  it('notifies listeners with a null directory for a directory-less event from an unknown session and still broadcasts it', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('unknown-a', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string }> = []
    aggregator.onEvent((directory, event) => { seen.push({ directory, type: event.type }) })

    const event = executionSucceededEvent(null, 'ses_unknown')
    await running.emit(event)

    expect(seen).toEqual([{ directory: null, type: 'session.execution.succeeded' }])
    expect(aggregator.getActiveSessions()).toEqual({})
    expect(client.frames.map(parseFrame)).toEqual([{ directory: null, payload: event }])
  })

  it('notifies listeners with a null directory for a session.deleted with no location and no remembered directory', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('deleted-unknown', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    aggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    const event = deletedEvent(null, 'ses_unknown')
    await running.emit(event)

    expect(seen).toEqual([{ directory: null, type: 'session.deleted', sessionID: 'ses_unknown' }])
    expect(client.frames.map(parseFrame)).toEqual([{ directory: null, payload: event }])
  })

  it('passes the resolved directory to listeners for a located session.deleted', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('deleted-located', client.callback, client.writeFrame, ['/r'])

    const seen: Array<{ directory: string | null; type: string }> = []
    aggregator.onEvent((directory, event) => { seen.push({ directory, type: event.type }) })

    const event = deletedEvent('/r', 'ses_located')
    await running.emit(event)

    expect(seen).toEqual([{ directory: '/r', type: 'session.deleted' }])
    expect(client.frames.map(parseFrame)).toEqual([{ directory: '/r', payload: event }])
  })

  it('forgets the remembered directory when session.deleted arrives', async () => {
    const running = await startAggregator()
    const client = createCapturingClient()
    aggregator.addClient('deleted-a', client.callback, client.writeFrame, ['/r'])

    const seen: Array<string | null> = []
    aggregator.onEvent((directory) => { seen.push(directory) })

    await running.emit(createdEvent('/r', 'ses_del'))
    await running.emit(deletedEvent(null, 'ses_del'))

    seen.length = 0
    const orphan = executionSucceededEvent(null, 'ses_del')
    await running.emit(orphan)

    expect(seen).toEqual([null])
    expect(aggregator.getActiveSessions()).toEqual({})
    expect(client.frames.map(parseFrame).at(-1)).toEqual({ directory: null, payload: orphan })
  })

  it('resolves a directory-less session.forked from the remembered parent directory and notifies listeners', async () => {
    const running = await startAggregator()
    const subscribed = createCapturingClient()
    const global = createCapturingClient()
    aggregator.addClient('fork-a', subscribed.callback, subscribed.writeFrame, ['/r'])
    aggregator.addClient('fork-b', global.callback, global.writeFrame, [])

    const seen: Array<{ directory: string | null; type: string; sessionID: string }> = []
    aggregator.onEvent((directory, event) => {
      seen.push({ directory, type: event.type, sessionID: sessionIDFromEvent(event) ?? '' })
    })

    await running.emit(createdEvent('/r', 'ses_source'))
    seen.length = 0

    const fork = forkedEvent(null, 'ses_fork', 'ses_source')
    await running.emit(fork)

    expect(seen).toEqual([{ directory: '/r', type: 'session.forked', sessionID: 'ses_fork' }])

    expect(subscribed.frames.map(parseFrame).at(-1)).toEqual({ directory: null, payload: fork })
    expect(global.frames.map(parseFrame).at(-1)).toEqual({ directory: null, payload: fork })

    seen.length = 0
    await running.emit(executionSucceededEvent(null, 'ses_fork'))

    expect(seen).toEqual([{ directory: '/r', type: 'session.execution.succeeded', sessionID: 'ses_fork' }])
  })
})

describe('SSEAggregator server-aware event feed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('notifies server listeners for local events with the local server id and resolved directory', async () => {
    const running = await startAggregator()
    const seen: Array<{ serverId: string; directory: string | null; type: string }> = []
    aggregator.onServerEvent((serverId, directory, event) => {
      seen.push({ serverId, directory, type: event.type })
    })

    await running.emit(createdEvent('/r', 'ses_1'))
    await running.emit(executionSucceededEvent(null, 'ses_1'))

    expect(seen).toEqual([
      { serverId: 'local', directory: '/r', type: 'session.created' },
      { serverId: 'local', directory: '/r', type: 'session.execution.succeeded' },
    ])
  })

  it('delivers remote events with the remote server id without touching local active or subagent state', () => {
    const seen: Array<{ serverId: string; directory: string | null; type: string }> = []
    aggregator.onServerEvent((serverId, directory, event) => {
      seen.push({ serverId, directory, type: event.type })
    })

    aggregator.notifyServerEvent('srv_a', '/repo', createdEvent('/repo', 'ses_remote', 'ses_parent'))

    expect(seen).toEqual([{ serverId: 'srv_a', directory: '/repo', type: 'session.created' }])
    expect(aggregator.getActiveSessions()).toEqual({})
    expect(aggregator.isSubagentSession('ses_remote')).toBe(false)
    expect(aggregator.isSubagentSession('ses_remote', 'srv_a')).toBe(false)
  })

  it('isolates a throwing server event listener from the others', () => {
    const throwing = vi.fn(() => { throw new Error('boom') })
    const healthy = vi.fn()
    aggregator.onServerEvent(throwing)
    const unsubscribe = aggregator.onServerEvent(healthy)

    aggregator.notifyServerEvent('srv_a', '/repo', idleEvent(null, 'ses_1'))

    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)

    unsubscribe()
    aggregator.notifyServerEvent('srv_a', '/repo', idleEvent(null, 'ses_1'))
    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it('notifies server-connected listeners for the local upstream and for remote streams', async () => {
    const running = await startAggregator()
    const seen: string[] = []
    aggregator.onServerConnected(serverId => { seen.push(serverId) })

    await running.emit(serverConnectedEvent())
    aggregator.notifyServerConnected('srv_a')

    expect(seen).toEqual(['local', 'srv_a'])
  })

  it('scopes session visibility to the active server id', () => {
    aggregator.addClient('viewed-local', () => {}, () => {}, ['/r'])
    aggregator.addClient('viewed-remote', () => {}, () => {}, ['srv_a|/r'])

    aggregator.setClientVisibility('viewed-local', true, 'ses_1')
    aggregator.setClientVisibility('viewed-remote', true, 'ses_2', 'srv_a')

    expect(aggregator.isSessionBeingViewed('ses_1')).toBe(true)
    expect(aggregator.isSessionBeingViewed('ses_1', 'srv_a')).toBe(false)
    expect(aggregator.isSessionBeingViewed('ses_2', 'srv_a')).toBe(true)
    expect(aggregator.isSessionBeingViewed('ses_2')).toBe(false)
  })

  it('clears the active server id when a client reports it is hidden', () => {
    aggregator.addClient('viewed-hidden', () => {}, () => {}, ['srv_a|/r'])
    aggregator.setClientVisibility('viewed-hidden', true, 'ses_1', 'srv_a')
    aggregator.setClientVisibility('viewed-hidden', false)

    expect(aggregator.isSessionBeingViewed('ses_1', 'srv_a')).toBe(false)
  })
})

describe('SSEAggregator location-scoped catalog event broadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it.each<CatalogEventType>(['command.updated', 'agent.updated', 'skill.updated', 'model.updated', 'provider.updated', 'integration.updated'])(
    'broadcasts a location-scoped %s catalog event to every client without leaking other location-scoped events',
    async (type) => {
      const running = await startAggregator()
      const subscribed = createCapturingClient()
      const unsubscribed = createCapturingClient()
      aggregator.addClient('catalog-a', subscribed.callback, subscribed.writeFrame, ['/repo-a'])
      aggregator.addClient('catalog-b', unsubscribed.callback, unsubscribed.writeFrame, [])

      const seen: Array<{ directory: string | null; type: string }> = []
      aggregator.onEvent((directory, event) => {
        seen.push({ directory, type: event.type })
      })

      const event = CATALOG_EVENTS[type]('/repo-c')
      await running.emit(event)

      const expected = { directory: null, payload: event }
      expect(subscribed.frames.map(parseFrame)).toEqual([expected])
      expect(unsubscribed.frames.map(parseFrame)).toEqual([expected])
      expect(seen).toEqual([{ directory: '/repo-c', type }])

      await running.emit(statusEvent('/repo-c', 'ses-1', { type: 'busy' }))

      expect(subscribed.frames).toHaveLength(1)
      expect(unsubscribed.frames).toHaveLength(1)
    },
  )
})

describe('SSEAggregator upstream transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('streams through the OpenCode client host override and resolved password', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const fetchStub = createFetchStub(async () => new Response(
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
      fetchFn: fetchStub,
    })

    const captured = createCapturingClient()
    aggregator.addClient('transport-a', captured.callback, captured.writeFrame, ['/repo'])
    aggregator.setOpenCodeClient(client)
    aggregator.start()
    await settle()

    expect(fetchStub).toHaveBeenCalledTimes(1)
    const call = fetchStub.mock.calls[0]
    if (call === undefined) throw new Error('Expected the upstream stream to fetch')
    const [url, init] = call
    expect(String(url)).toBe('http://10.20.30.40:5551/api/event')
    expect(new Headers(init?.headers).get('Authorization')).toBe(buildOpenCodeBasicAuth('resolved-secret'))

    const encoder = new TextEncoder()
    streamController!.enqueue(encoder.encode(`data: ${JSON.stringify(serverConnectedEvent())}\n\n`))
    const busy = statusEvent('/repo', 'ses-1', { type: 'busy' })
    streamController!.enqueue(encoder.encode(`data: ${JSON.stringify(busy)}\n\n`))
    await settle()

    expect(captured.events.filter(event => event.event === 'resync')).toHaveLength(1)
    expect(captured.frames.map(parseFrame).filter(frame => frame.payload.type === 'session.status')).toEqual([
      { directory: '/repo', payload: busy },
    ])

    streamController!.close()
  })
})

describe('SSEAggregator upstream reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = createSSEAggregator()
    aggregator.setScheduledSessionsResolver(() => [])
  })

  afterEach(() => {
    aggregator.shutdown()
    vi.useRealTimers()
  })

  it('reconnects after the stream ends, broadcasting resync and replaying tracked statuses', async () => {
    const running = await startAggregator({ active: { 'ses-1': { type: 'running' } } })
    const client = createCapturingClient()
    aggregator.addClient('reconnect-a', client.callback, client.writeFrame, ['/repo/a'])

    await running.emit(serverConnectedEvent())
    await running.emit(statusEvent('/repo/a', 'ses-1', { type: 'busy' }))

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(1)
    expect(aggregator.getActiveSessions()).toEqual({ '/repo/a': ['ses-1'] })

    await reconnect(running)

    expect(running.upstream.fetchCalls()).toBe(2)
    await running.emit(serverConnectedEvent())

    expect(client.events.filter(event => event.event === 'resync')).toHaveLength(2)
    expect(running.upstream.activeSessions).toHaveBeenCalledTimes(1)
    const statuses = statusFrames(client)
    expect(statuses.at(-1)?.payload.data).toEqual({ sessionID: 'ses-1', status: { type: 'busy' } })
  })
})
