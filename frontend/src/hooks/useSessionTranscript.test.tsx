import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionInboxInfo,
  SessionMessageInfo,
  V2Event,
} from '@opencode-manager/shared/opencode'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { useSessionTranscript } from './useSessionTranscript'
import { useContextUsage } from './useContextUsage'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { applySessionEvent, emptySessionTranscript } from '@/lib/session-projection'
import type { TranscriptCache } from '@/lib/session-projection'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { openCodeEventStream } from '@/lib/opencode-event-stream'
import { TestEventStreamTransport } from '@/lib/opencode-event-stream/testTransport'
import { createTestQueryClient } from '@/test/render'
import { createFetchFake, type FetchFake, type FetchRoute } from '@/test/fetchFake'
import { makeCatalogModel, makeCatalogProvider } from '@/test/fixtures/api'
import {
  ASSISTANT_MESSAGE_ID,
  SESSION_ID,
  TOOL_ID,
  USER_INBOX_ID,
  eventID,
  executionSequence,
  messageID,
  otherSessionSequence,
  promptSequence,
  textStreamSequence,
} from '@/test/fixtures/session-projection'

const DIRECTORY = '/repo'
const SECOND_SESSION_ID = 'ses_2'
const MESSAGE_ROUTE = '/api/opencode/api/session/:sessionID/message'
const STATUS_ROUTE = '/api/opencode-servers/status'
const CATALOG_ROUTES: FetchRoute[] = [
  { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [makeCatalogProvider()] } }) },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({ json: { data: [makeCatalogModel({ providerID: 'anthropic', id: 'claude-sonnet-4-5', modelID: 'claude-sonnet-4-5' })] } }),
  },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: [] }) },
]

interface SnapshotValue {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: 'idle' | 'busy'
  nextCursor?: string
}

interface PageMessagesRef {
  current: SessionMessageInfo[]
}

interface OlderPage {
  messages: SessionMessageInfo[]
  nextCursor?: string
}

interface SnapshotServer {
  fetchFake: FetchFake
  setSnapshot: (snapshot: SnapshotValue) => void
  setOlderPage: (cursor: string, page: OlderPage) => void
  setServerConnected: (connected: boolean) => void
  deferNextRead: () => () => void
  deferCursorRead: (cursor: string) => () => void
  reads: () => number
  cursorReads: () => string[]
}

interface DeferredRead {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): DeferredRead {
  let resolve = () => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function snapshotServer(initial: SnapshotValue): SnapshotServer {
  let snapshot = initial
  let serverConnected = false
  const olderPages = new Map<string, OlderPage>()
  let readGate: DeferredRead | null = null
  const deferredCursorReads = new Map<string, DeferredRead>()
  const cursorReads: string[] = []
  let reads = 0

  async function passReadGate(): Promise<void> {
    const gate = readGate
    if (gate) await gate.promise
  }

  function messageRoute(prefix: string): FetchRoute {
    return {
      method: 'GET',
      path: `${prefix}/api/session/:sessionID/message`,
      respond: async (request) => {
        const cursor = request.searchParams.get('cursor')
        if (cursor === null) {
          reads += 1
          await passReadGate()
          return {
            json: {
              data: [...snapshot.messages].reverse(),
              cursor: snapshot.nextCursor === undefined ? {} : { next: snapshot.nextCursor },
            },
          }
        }
        cursorReads.push(cursor)
        const deferredCursorRead = deferredCursorReads.get(cursor)
        if (deferredCursorRead) {
          deferredCursorReads.delete(cursor)
          await deferredCursorRead.promise
        }
        const page = olderPages.get(cursor) ?? { messages: [] }
        return {
          json: {
            data: [...page.messages].reverse(),
            cursor: page.nextCursor === undefined ? {} : { next: page.nextCursor },
          },
        }
      },
    }
  }

  function inboxRoute(prefix: string): FetchRoute {
    return {
      method: 'GET',
      path: `${prefix}/api/session/:sessionID/inbox`,
      respond: async () => {
        await passReadGate()
        return { json: { data: snapshot.pending } }
      },
    }
  }

  function activeRoute(prefix: string): FetchRoute {
    return {
      method: 'GET',
      path: `${prefix}/api/session/active`,
      respond: async () => {
        await passReadGate()
        return {
          json: { data: snapshot.status === 'busy' ? { [SESSION_ID]: { type: 'running' } } : {} },
        }
      },
    }
  }

  const routes: FetchRoute[] = [
    messageRoute('/api/opencode'),
    inboxRoute('/api/opencode'),
    activeRoute('/api/opencode'),
    messageRoute('/api/opencode/servers/srv_remote'),
    inboxRoute('/api/opencode/servers/srv_remote'),
    activeRoute('/api/opencode/servers/srv_remote'),
    {
      method: 'GET',
      path: STATUS_ROUTE,
      respond: () => ({
        json: {
          statuses: [{ serverId: 'srv_remote', connected: serverConnected, version: null, error: null }],
        },
      }),
    },
    ...CATALOG_ROUTES,
  ]

  return {
    fetchFake: createFetchFake(routes),
    setSnapshot: (next) => {
      snapshot = next
    },
    setOlderPage: (cursor, page) => {
      olderPages.set(cursor, page)
    },
    setServerConnected: (connected) => {
      serverConnected = connected
    },
    deferNextRead: () => {
      const next = deferred()
      readGate = next
      return () => {
        readGate = null
        next.resolve()
      }
    },
    deferCursorRead: (cursor) => {
      const next = deferred()
      deferredCursorReads.set(cursor, next)
      return next.resolve
    },
    reads: () => reads,
    cursorReads: () => cursorReads,
  }
}

const seededMessages: SessionMessageInfo[] = [
  { id: USER_INBOX_ID, type: 'user', text: 'Run the tests', time: { created: 1000 } },
  {
    id: ASSISTANT_MESSAGE_ID,
    type: 'assistant',
    agent: 'build',
    model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
    content: [],
    time: { created: 1020 },
  },
]

const queuedPrompt: SessionInboxInfo = {
  id: messageID(200),
  sessionID: SESSION_ID,
  time: { created: 20000 },
  type: 'user',
  payload: { text: 'Wait for me' },
  delivery: 'queue',
}

const deliveredPromptEvent: V2Event = {
  id: eventID(201),
  created: 20100,
  type: 'session.inbox.delivered',
  durable: { aggregateID: SESSION_ID, seq: 201, version: 1 },
  data: { sessionID: SESSION_ID, inboxID: queuedPrompt.id },
}

function createQueryClient(): QueryClient {
  return createTestQueryClient()
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createRemoteWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <OpenCodeServerProvider serverId="srv_remote">{children}</OpenCodeServerProvider>
      </QueryClientProvider>
    )
  }
}

describe('useSessionTranscript', () => {
  let server: SnapshotServer
  let transport: TestEventStreamTransport

  function sendEvent(event: V2Event): void {
    transport.message({ payload: event })
  }

  function resync(payload?: JsonValue): void {
    transport.resync(payload)
  }

  beforeEach(() => {
    transport = new TestEventStreamTransport()
    openCodeEventStream.setTransport(transport)
    server = snapshotServer({ messages: seededMessages, pending: [], status: 'idle' })
    server.fetchFake.install()
  })

  it('applies streamed session events to the seeded transcript', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      textStreamSequence.slice(1, 3).forEach(sendEvent)
    })

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello ' }])
    })
  })

  it('ignores events for other sessions', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      otherSessionSequence.forEach(sendEvent)
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.pending).toEqual([])
    expect(result.current.status).toBe('idle')
  })

  it('refetches the newest page after the event stream reconnects', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const reconnected: SessionMessageInfo[] = [
      { id: messageID(300), type: 'synthetic', text: 'Reconnected', time: { created: 30000 } },
    ]
    server.setSnapshot({ messages: reconnected, pending: [], status: 'idle' })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => {
      expect(server.reads()).toBe(2)
      expect(result.current.messages).toEqual(reconnected)
    })
  })

  it('refetches the newest page on an upstream resync while the browser stream stays connected', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const recovered: SessionMessageInfo[] = [
      { id: messageID(400), type: 'synthetic', text: 'Recovered', time: { created: 40000 } },
    ]
    server.setSnapshot({ messages: recovered, pending: [], status: 'idle' })

    act(() => {
      resync()
    })

    await waitFor(() => {
      expect(server.reads()).toBe(2)
      expect(result.current.messages).toEqual(recovered)
    })
  })

  it('ignores a resync scoped to another server', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(server.reads()).toBe(1)

    await act(async () => {
      resync({ timestamp: Date.now(), serverId: 'srv_remote' })
    })

    expect(server.reads()).toBe(1)
  })

  it('refetches the newest page on a resync scoped to its own remote server', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createRemoteWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(server.reads()).toBe(1)

    await act(async () => {
      resync({ timestamp: Date.now(), serverId: 'srv_remote' })
    })

    await waitFor(() => expect(server.reads()).toBe(2))
  })

  it('reads the newest page once on a fresh mount with no cached transcript', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    await act(async () => {})
    expect(server.reads()).toBe(1)
  })

  it('refreshes a cached transcript when switching to another session', async () => {
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      ({ sessionID }: { sessionID: string }) => useSessionTranscript(sessionID, DIRECTORY),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { sessionID: SESSION_ID },
      },
    )

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(server.reads()).toBe(1)

    const staleBusy: TranscriptCache = {
      transcript: { messages: seededMessages, pending: [], status: 'busy' },
    }
    queryClient.setQueryData(sessionTranscriptQueryKey(SECOND_SESSION_ID), staleBusy)

    rerender({ sessionID: SECOND_SESSION_ID })

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(server.reads()).toBe(2)
    expect(server.fetchFake.lastRequest('GET', MESSAGE_ROUTE)?.path).toBe(`/api/opencode/api/session/${SECOND_SESSION_ID}/message`)
  })

  it('refreshes a stale cached transcript when the hook remounts', async () => {
    const queryClient = createQueryClient()
    server.setSnapshot({ messages: seededMessages, pending: [], status: 'busy' })
    const first = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(first.result.current.status).toBe('busy'))
    first.unmount()

    server.setSnapshot({ messages: seededMessages, pending: [], status: 'idle' })
    const second = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(second.result.current.status).toBe('idle'))
    expect(server.reads()).toBe(2)
  })

  it('applies events buffered during the refresh read triggered by an existing cache', async () => {
    const queryClient = createQueryClient()
    const settledAssistant: SessionMessageInfo = {
      id: ASSISTANT_MESSAGE_ID,
      type: 'assistant',
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      content: [],
      time: { created: 1020, completed: 1030 },
    }
    queryClient.setQueryData<TranscriptCache>(sessionTranscriptQueryKey(SESSION_ID), {
      transcript: {
        messages: [seededMessages[0], settledAssistant],
        pending: [],
        status: 'busy',
      },
    })

    const releaseRefresh = server.deferNextRead()

    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(server.reads()).toBe(1))

    act(() => {
      sendEvent(executionSequence[1])
    })

    server.setSnapshot({
      messages: [seededMessages[0], settledAssistant],
      pending: [],
      status: 'busy',
    })
    await act(async () => {
      releaseRefresh()
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(server.reads()).toBe(1)
  })

  it('seeds a queued prompt and a busy session from the snapshot on mount', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [queuedPrompt], status: 'busy' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.pending).toEqual([queuedPrompt]))

    expect(result.current.status).toBe('busy')
    expect(result.current.messages).toMatchObject([
      { id: USER_INBOX_ID, type: 'user' },
      { id: ASSISTANT_MESSAGE_ID, type: 'assistant' },
      { id: queuedPrompt.id, type: 'user', text: 'Wait for me' },
    ])
  })

  it('removes stale pending prompts and busy status after missed delivery and cancellation', async () => {
    const cancelledPrompt: SessionInboxInfo = {
      id: messageID(210),
      sessionID: SESSION_ID,
      time: { created: 21000 },
      type: 'user',
      payload: { text: 'Never mind' },
      delivery: 'steer',
    }
    const waitingPrompt: SessionInboxInfo = {
      id: messageID(220),
      sessionID: SESSION_ID,
      time: { created: 22000 },
      type: 'user',
      payload: { text: 'After that' },
      delivery: 'queue',
    }
    server.setSnapshot({
      messages: seededMessages,
      pending: [queuedPrompt, cancelledPrompt, waitingPrompt],
      status: 'busy',
    })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.pending).toHaveLength(3))

    const delivered: SessionMessageInfo = {
      id: queuedPrompt.id,
      type: 'user',
      text: 'Wait for me',
      time: { created: 20100 },
    }
    server.setSnapshot({
      messages: [...seededMessages, delivered],
      pending: [waitingPrompt],
      status: 'idle',
    })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => expect(server.reads()).toBe(2))

    await waitFor(() => expect(result.current.pending).toEqual([waitingPrompt]))
    expect(result.current.status).toBe('idle')
    expect(result.current.messages.filter((message) => message.id === queuedPrompt.id)).toEqual([
      delivered,
    ])
    expect(result.current.messages.some((message) => message.id === cancelledPrompt.id)).toBe(false)
    expect(result.current.messages.some((message) => message.id === waitingPrompt.id)).toBe(true)
  })

  it('applies events buffered during the initial load onto the snapshot with a single read', async () => {
    const releaseInitial = server.deferNextRead()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(server.reads()).toBe(1))

    act(() => {
      textStreamSequence.slice(1, 3).forEach(sendEvent)
    })

    server.setSnapshot({ messages: seededMessages, pending: [], status: 'idle' })
    await act(async () => {
      releaseInitial()
    })

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello ' }])
    })
    expect(result.current.messages).toHaveLength(2)
    expect(server.reads()).toBe(1)
  })

  it('does not re-append a buffered delta for a part the snapshot already contains', async () => {
    const releaseInitial = server.deferNextRead()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(server.reads()).toBe(1))

    act(() => {
      sendEvent(textStreamSequence[2])
    })

    const assistantWithText: SessionMessageInfo = {
      id: ASSISTANT_MESSAGE_ID,
      type: 'assistant',
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      content: [{ type: 'text', text: 'Hello ' }],
      time: { created: 1020 },
    }
    server.setSnapshot({ messages: [seededMessages[0], assistantWithText], pending: [], status: 'idle' })
    await act(async () => {
      releaseInitial()
    })

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello ' }])
    })
    expect(server.reads()).toBe(1)
  })

  it('does not duplicate a buffered text part the snapshot already contains', async () => {
    const releaseInitial = server.deferNextRead()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(server.reads()).toBe(1))

    act(() => {
      sendEvent(textStreamSequence[1])
      sendEvent(textStreamSequence[2])
    })

    const assistantWithText: SessionMessageInfo = {
      id: ASSISTANT_MESSAGE_ID,
      type: 'assistant',
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      content: [{ type: 'text', text: 'Hello ' }],
      time: { created: 1020 },
    }
    server.setSnapshot({ messages: [seededMessages[0], assistantWithText], pending: [], status: 'idle' })
    await act(async () => {
      releaseInitial()
    })

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello ' }])
    })
    expect(server.reads()).toBe(1)
  })

  it('does not refetch the transcript on window focus', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      transport.connected()
    })
    await waitFor(() => expect(server.reads()).toBe(2))

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.reads()).toBe(2)
    focusManager.setFocused(undefined)
  })

  it('polls the newest page every 5s while the event stream is disconnected and stops once connected', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createWrapper(createQueryClient()),
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(server.reads()).toBe(1)
      expect(result.current.messages).toHaveLength(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(server.reads()).toBe(2)

      act(() => {
        transport.connected()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const readsAfterConnect = server.reads()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(server.reads()).toBe(readsAfterConnect)
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls a remote transcript while the remote server is disconnected even when the browser stream is connected', async () => {
    vi.useFakeTimers()
    try {
      server.setServerConnected(false)
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createRemoteWrapper(createQueryClient()),
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.messages).toHaveLength(2)

      act(() => {
        transport.connected()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const readsAfterConnect = server.reads()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(server.reads()).toBeGreaterThan(readsAfterConnect)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops polling a remote transcript once both the browser stream and the remote server are connected', async () => {
    vi.useFakeTimers()
    try {
      server.setServerConnected(true)
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createRemoteWrapper(createQueryClient()),
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.messages).toHaveLength(2)

      act(() => {
        transport.connected()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const readsAfterConnect = server.reads()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(server.reads()).toBe(readsAfterConnect)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the local transcript polling behavior independent of server statuses', async () => {
    vi.useFakeTimers()
    try {
      server.setServerConnected(false)
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createWrapper(createQueryClient()),
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.messages).toHaveLength(2)

      act(() => {
        transport.connected()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const readsAfterConnect = server.reads()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(server.reads()).toBe(readsAfterConnect)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the newest page once when execution ends while a tool is still running', async () => {
    const running = promptSequence.slice(0, 15).reduce(applySessionEvent, emptySessionTranscript)
    server.setSnapshot({ messages: running.messages, pending: [], status: 'busy' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.status).toBe('busy'))

    act(() => {
      sendEvent(executionSequence[1])
    })

    await waitFor(() => expect(server.reads()).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.reads()).toBe(2)
  })

  it('does not roll back a settled execution when a delayed reconnect read resolves', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [], status: 'busy' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.status).toBe('busy'))

    const releaseReconnect = server.deferNextRead()
    server.setSnapshot({
      messages: [
        ...seededMessages,
        { id: messageID(91), type: 'idle', outcome: 'succeeded', time: { created: 9010 } },
      ],
      pending: [],
      status: 'idle',
    })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => expect(server.reads()).toBe(2))

    act(() => {
      sendEvent(executionSequence[1])
    })

    await act(async () => {
      releaseReconnect()
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
      messageID(91),
    ])
  })

  it('reconciles a pending delivery that arrives while the reconnect read is pending', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [queuedPrompt], status: 'idle' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.pending).toEqual([queuedPrompt]))

    const releaseReconnect = server.deferNextRead()
    const delivered: SessionMessageInfo = {
      id: queuedPrompt.id,
      type: 'user',
      text: 'Wait for me',
      time: { created: 20100 },
    }
    server.setSnapshot({ messages: [...seededMessages, delivered], pending: [], status: 'idle' })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => expect(server.reads()).toBe(2))

    act(() => {
      sendEvent(deliveredPromptEvent)
    })

    const staleSnapshot = { messages: seededMessages, pending: [queuedPrompt], status: 'idle' as const }
    server.setSnapshot(staleSnapshot)
    await act(async () => {
      releaseReconnect()
    })

    await waitFor(() => expect(result.current.pending).toEqual([]))
    expect(result.current.messages.filter((message) => message.id === queuedPrompt.id)).toEqual([
      { id: queuedPrompt.id, type: 'user', text: 'Wait for me', time: { created: 20100 } },
    ])
  })

  it('applies a status event buffered during the reconnect read without re-reading', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const releaseReconnect = server.deferNextRead()
    const reconnected: SessionMessageInfo = {
      id: messageID(300),
      type: 'synthetic',
      text: 'Reconnected',
      time: { created: 30000 },
    }
    server.setSnapshot({ messages: [...seededMessages, reconnected], pending: [], status: 'idle' })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => expect(server.reads()).toBe(2))

    act(() => {
      sendEvent({
        id: eventID(180),
        created: 18000,
        type: 'session.status',
        data: { sessionID: SESSION_ID, status: { type: 'busy' } },
      })
    })

    await act(async () => {
      releaseReconnect()
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(3))
    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
      reconnected.id,
    ])
    expect(result.current.status).toBe('busy')
    expect(server.reads()).toBe(2)
  })

  it('keeps older loaded pages and the older cursor after an overlapping newest-page read', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [], status: 'idle', nextCursor: 'cursor_1' })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.hasOlder).toBe(true))

    const olderMessage: SessionMessageInfo = {
      id: messageID(0),
      type: 'synthetic',
      text: 'Earlier',
      time: { created: 900 },
    }
    server.setOlderPage('cursor_1', { messages: [olderMessage], nextCursor: 'cursor_0' })
    await act(async () => {
      await result.current.fetchOlder()
    })

    const newer: SessionMessageInfo = {
      id: messageID(300),
      type: 'synthetic',
      text: 'Later',
      time: { created: 30000 },
    }
    server.setSnapshot({ messages: [...seededMessages, newer], pending: [], status: 'idle', nextCursor: 'cursor_new' })

    act(() => {
      resync()
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(4))
    expect(result.current.messages.map((message) => message.id)).toEqual([
      olderMessage.id,
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
      newer.id,
    ])
    expect(queryClient.getQueryData<{ nextCursor?: string }>(sessionTranscriptQueryKey(SESSION_ID))?.nextCursor).toBe(
      'cursor_0',
    )
    expect(server.reads()).toBe(2)
  })

  it('discards an older-page response superseded by a newest-page read that leaves a gap', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [], status: 'idle', nextCursor: 'cursor_1' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.hasOlder).toBe(true))

    const releaseOlder = server.deferCursorRead('cursor_1')
    let older: Promise<void> | undefined
    act(() => {
      older = result.current.fetchOlder()
    })
    expect(server.cursorReads()).toEqual(['cursor_1'])

    const gapPage: SessionMessageInfo = {
      id: messageID(300),
      type: 'synthetic',
      text: 'Much later',
      time: { created: 30000 },
    }
    const releaseReconnect = server.deferNextRead()
    server.setSnapshot({ messages: [gapPage], pending: [], status: 'idle', nextCursor: 'cursor_2' })

    act(() => {
      transport.fail()
      transport.connected()
    })

    await waitFor(() => expect(server.reads()).toBe(2))

    await act(async () => {
      releaseReconnect()
    })

    const olderMessage: SessionMessageInfo = {
      id: messageID(0),
      type: 'synthetic',
      text: 'Earlier',
      time: { created: 900 },
    }
    server.setOlderPage('cursor_1', { messages: [olderMessage], nextCursor: 'cursor_3' })
    await act(async () => {
      releaseOlder()
      await older
    })

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.id)).toEqual([gapPage.id]),
    )

    await act(async () => {
      await result.current.fetchOlder()
    })

    expect(server.cursorReads()).toEqual(['cursor_1', 'cursor_2'])
  })

  it('loads older pages with fetchOlder until the cursor is exhausted', async () => {
    server.setSnapshot({ messages: seededMessages, pending: [], status: 'idle', nextCursor: 'cursor_1' })
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.hasOlder).toBe(true))

    const olderMessage: SessionMessageInfo = {
      id: messageID(0),
      type: 'synthetic',
      text: 'Earlier',
      time: { created: 900 },
    }
    server.setOlderPage('cursor_1', { messages: [olderMessage] })

    await act(async () => {
      await result.current.fetchOlder()
    })

    expect(server.cursorReads()).toEqual(['cursor_1'])
    await waitFor(() => {
      expect(result.current.messages.map((message) => message.id)).toEqual([
        olderMessage.id,
        USER_INBOX_ID,
        ASSISTANT_MESSAGE_ID,
      ])
    })
    expect(result.current.hasOlder).toBe(false)
  })

  it('batches events for one session into a single animation frame', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const frames: FrameRequestCallback[] = []
    const requestAnimationFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })

    act(() => {
      promptSequence.slice(0, 2).forEach(sendEvent)
      textStreamSequence.slice(0, 2).forEach(sendEvent)
    })

    expect(frames).toHaveLength(1)

    act(() => {
      frames[0]?.(0)
    })

    expect(result.current.pending).toEqual([])
    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
    ])

    requestAnimationFrame.mockRestore()
  })

  it('reports the session status from status events', async () => {
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      sendEvent({
        id: eventID(170),
        created: 17000,
        type: 'session.status',
        data: {
          sessionID: SESSION_ID,
          status: { type: 'retry', attempt: 1, message: 'slow down', next: 17010 },
        },
      })
    })

    await waitFor(() => expect(result.current.status).toBe('retry'))
  })

  it('applies streamed deltas exactly once across the transcript and context-usage consumers', async () => {
    const queryClient = createQueryClient()
    const pageMessages: PageMessagesRef = { current: [] }

    function PageConsumers() {
      const { messages } = useSessionTranscript(SESSION_ID, DIRECTORY)
      pageMessages.current = messages
      useContextUsage(SESSION_ID, DIRECTORY)
      return null
    }

    render(<PageConsumers />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(pageMessages.current).toHaveLength(2))

    act(() => {
      sendEvent(textStreamSequence[1])
      sendEvent(textStreamSequence[2])
      sendEvent(promptSequence[7])
      sendEvent(promptSequence[8])
      sendEvent(promptSequence[11])
      sendEvent(promptSequence[12])
    })

    await waitFor(() => {
      const assistant = pageMessages.current[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')

      const text = assistant.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
      expect(text).toBe('Hello ')

      const reasoning = assistant.content
        .filter((part) => part.type === 'reasoning')
        .map((part) => part.text)
        .join('')
      expect(reasoning).toBe('Checking ')

      const tool = assistant.content.find((part) => part.type === 'tool' && part.id === TOOL_ID)
      if (tool?.type !== 'tool') throw new Error('expected a streaming tool entry')
      expect(tool.state.status).toBe('streaming')
      expect(tool.state.status === 'streaming' ? tool.state.input : '').toBe('{"command":')
    })
  })
})
