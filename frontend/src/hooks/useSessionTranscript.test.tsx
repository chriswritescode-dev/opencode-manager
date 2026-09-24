import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionInboxInfo,
  SessionMessageInfo,
  V2Event,
} from '@opencode-manager/shared/opencode'
import { useSessionTranscript } from './useSessionTranscript'
import { ContextUsageIndicator } from '@/components/session/ContextUsageIndicator'
import {
  ASSISTANT_MESSAGE_ID,
  SESSION_ID,
  TOOL_ID,
  USER_INBOX_ID,
  compactionSequence,
  eventID,
  executionSequence,
  failedCompactionSequence,
  messageID,
  otherSessionSequence,
  promptSequence,
  textGrowthSequence,
  textStreamSequence,
} from '@/lib/session-projection/fixtures'

const mocks = vi.hoisted(() => ({
  listSessionMessages: vi.fn(),
  readSessionSnapshot: vi.fn(),
  transport: null as unknown,
}))

vi.mock('@/api/opencode', () => ({
  listSessionMessages: mocks.listSessionMessages,
  readSessionSnapshot: mocks.readSessionSnapshot,
}))

vi.mock('@/lib/opencode-event-stream', async () => {
  const { OpenCodeEventStream } = await import('@/lib/opencode-event-stream/openCodeEventStream')
  const { TestEventStreamTransport } = await import('@/lib/opencode-event-stream/testTransport')
  const transport = new TestEventStreamTransport()
  mocks.transport = transport
  return { openCodeEventStream: new OpenCodeEventStream({ transport }) }
})

const DIRECTORY = '/repo'

interface SnapshotValue {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  status: 'idle' | 'busy'
  nextCursor?: string
}

interface TestTransport {
  connected(): void
  fail(): void
  message(data: unknown): void
  resync(): void
}

function testTransport(): TestTransport {
  return mocks.transport as TestTransport
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useSessionTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readSessionSnapshot.mockReset()
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [],
      status: 'idle',
    })
  })

  it('applies streamed session events to the seeded transcript', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      textStreamSequence.slice(1, 3).forEach((event) => testTransport().message(event))
    })

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello ' }])
    })
  })

  it('ignores events for other sessions', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      otherSessionSequence.forEach((event: V2Event) => testTransport().message(event))
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.pending).toEqual([])
    expect(result.current.status).toBe('idle')
  })

  it('refetches the newest page after the event stream reconnects', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const reconnected: SessionMessageInfo[] = [
      { id: messageID(300), type: 'synthetic', text: 'Reconnected', time: { created: 30000 } },
    ]
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: reconnected,
      pending: [],
      status: 'idle',
    })

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => {
      expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2)
      expect(result.current.messages).toEqual(reconnected)
    })
  })

  it('refetches the newest page on an upstream resync while the browser stream stays connected', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const recovered: SessionMessageInfo[] = [
      { id: messageID(400), type: 'synthetic', text: 'Recovered', time: { created: 40000 } },
    ]
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: recovered,
      pending: [],
      status: 'idle',
    })

    act(() => {
      testTransport().resync()
    })

    await waitFor(() => {
      expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2)
      expect(result.current.messages).toEqual(recovered)
    })
  })

  it('seeds a queued prompt and a busy session from the snapshot on mount', async () => {
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [queuedPrompt],
      status: 'busy',
    })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
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
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [queuedPrompt, cancelledPrompt, waitingPrompt],
      status: 'busy',
    })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.pending).toHaveLength(3))

    const delivered: SessionMessageInfo = {
      id: queuedPrompt.id,
      type: 'user',
      text: 'Wait for me',
      time: { created: 20100 },
    }
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: [...seededMessages, delivered],
      pending: [waitingPrompt],
      status: 'idle',
    })

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    await waitFor(() => expect(result.current.pending).toEqual([waitingPrompt]))
    expect(result.current.status).toBe('idle')
    expect(result.current.messages.filter((message) => message.id === queuedPrompt.id)).toEqual([
      delivered,
    ])
    expect(result.current.messages.some((message) => message.id === cancelledPrompt.id)).toBe(false)
    expect(result.current.messages.some((message) => message.id === waitingPrompt.id)).toBe(true)
  })

  it('replaces buffered initial-load events with the authoritative snapshot', async () => {
    const staleRead = deferred<{
      messages: SessionMessageInfo[]
      pending: SessionInboxInfo[]
      status: 'idle'
    }>()
    const authoritative = {
      messages: [
        seededMessages[0] as SessionMessageInfo,
        {
          id: ASSISTANT_MESSAGE_ID,
          type: 'assistant' as const,
          agent: 'build',
          model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
          content: [{ type: 'text' as const, text: 'Hello world' }],
          time: { created: 2000, streamed: 2020, completed: 2020 },
        },
      ],
      pending: [],
      status: 'idle' as const,
    }
    mocks.readSessionSnapshot
      .mockReturnValueOnce(staleRead.promise)
      .mockResolvedValue(authoritative)
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(1))

    act(() => {
      textStreamSequence.slice(1, 3).forEach((event) => testTransport().message(event))
    })

    await act(async () => {
      staleRead.resolve({ messages: seededMessages, pending: [], status: 'idle' })
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    await waitFor(() => {
      const assistant = result.current.messages[1]
      if (assistant?.type !== 'assistant') throw new Error('expected an assistant message')
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello world' }])
    })
    expect(result.current.messages).toHaveLength(2)
  })

  it('does not roll back a settled execution when a delayed reconnect read resolves', async () => {
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [],
      status: 'busy',
    })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.status).toBe('busy'))

    const reconnectRead = deferred<{
      messages: SessionMessageInfo[]
      pending: SessionInboxInfo[]
      status: 'busy'
    }>()
    mocks.readSessionSnapshot.mockReturnValueOnce(reconnectRead.promise).mockResolvedValue({
      messages: [
        ...seededMessages,
        { id: messageID(91), type: 'idle', outcome: 'succeeded', time: { created: 9010 } },
      ],
      pending: [],
      status: 'idle',
    })

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    act(() => {
      testTransport().message(executionSequence[1])
    })

    await act(async () => {
      reconnectRead.resolve({ messages: seededMessages, pending: [], status: 'busy' })
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
      messageID(91),
    ])
  })

  it('reconciles a pending delivery that arrives while the reconnect read is pending', async () => {
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [queuedPrompt],
      status: 'idle',
    })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.pending).toEqual([queuedPrompt]))

    const reconnectRead = deferred<{
      messages: SessionMessageInfo[]
      pending: SessionInboxInfo[]
      status: 'idle'
    }>()
    const delivered: SessionMessageInfo = {
      id: queuedPrompt.id,
      type: 'user',
      text: 'Wait for me',
      time: { created: 20100 },
    }
    mocks.readSessionSnapshot.mockReturnValueOnce(reconnectRead.promise).mockResolvedValue({
      messages: [...seededMessages, delivered],
      pending: [],
      status: 'idle',
    })

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    act(() => {
      testTransport().message(deliveredPromptEvent)
    })

    await act(async () => {
      reconnectRead.resolve({
        messages: seededMessages,
        pending: [queuedPrompt],
        status: 'idle',
      })
    })

    await waitFor(() => expect(result.current.pending).toEqual([]))
    expect(result.current.messages.filter((message) => message.id === queuedPrompt.id)).toEqual([
      { id: queuedPrompt.id, type: 'user', text: 'Wait for me', time: { created: 20100 } },
    ])
  })

  it('keeps a message only the authoritative reconnect read contains', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    const reconnectRead = deferred<{
      messages: SessionMessageInfo[]
      pending: SessionInboxInfo[]
      status: 'idle'
    }>()
    const reconnected: SessionMessageInfo = {
      id: messageID(300),
      type: 'synthetic',
      text: 'Reconnected',
      time: { created: 30000 },
    }
    mocks.readSessionSnapshot.mockReturnValueOnce(reconnectRead.promise).mockResolvedValue({
      messages: [...seededMessages, reconnected],
      pending: [],
      status: 'idle',
    })

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    act(() => {
      testTransport().message({
        id: eventID(180),
        created: 18000,
        type: 'session.status',
        data: { sessionID: SESSION_ID, status: { type: 'busy' } },
      })
    })

    await act(async () => {
      reconnectRead.resolve({ messages: seededMessages, pending: [], status: 'idle' })
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(result.current.messages).toHaveLength(3))
    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
      reconnected.id,
    ])
    expect(result.current.status).toBe('idle')
  })

  it('keeps the live projection when every newest-page read overlaps and settles on the authoritative read', async () => {
    const frames: FrameRequestCallback[] = []
    const requestAnimationFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    const flushFrames = () => {
      act(() => {
        frames.splice(0).forEach((frame) => frame(0))
      })
    }
    const reads = [0, 1, 2, 3, 4].map(() => deferred<SnapshotValue>())
    const streamed = textGrowthSequence.slice(2, 6)
    const overlapped: SnapshotValue[] = [
      { text: 'Hello ' },
      { text: 'Hello world' },
      { text: 'Hello world!' },
      { text: 'Hello world!?' },
    ].map(({ text }) => ({
      messages: [
        seededMessages[0] as SessionMessageInfo,
        {
          id: ASSISTANT_MESSAGE_ID,
          type: 'assistant' as const,
          agent: 'build',
          model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
          content: [{ type: 'text' as const, text }],
          time: { created: 14000 },
        },
      ],
      pending: [],
      status: 'idle' as const,
    }))
    const authoritative: SnapshotValue = {
      messages: [
        seededMessages[0] as SessionMessageInfo,
        {
          id: ASSISTANT_MESSAGE_ID,
          type: 'assistant',
          agent: 'build',
          model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
          content: [{ type: 'text', text: 'Hello world!?' }],
          time: { created: 14000, streamed: 14014, completed: 14014 },
        },
        {
          id: messageID(300),
          type: 'synthetic',
          text: 'Server only',
          time: { created: 30000 },
        },
      ],
      pending: [],
      status: 'idle',
    }
    const seededSnapshot: SnapshotValue = {
      messages: seededMessages,
      pending: [],
      status: 'idle',
    }
    mocks.readSessionSnapshot
      .mockResolvedValueOnce(seededSnapshot)
      .mockReturnValueOnce(reads[0].promise)
      .mockReturnValueOnce(reads[1].promise)
      .mockReturnValueOnce(reads[2].promise)
      .mockReturnValueOnce(reads[3].promise)
      .mockResolvedValueOnce(authoritative)
    try {
      const queryClient = createQueryClient()
      const cachedTranscript = () => {
        const cached = queryClient.getQueryData<{ transcript: SessionTranscript }>([
          'opencode',
          'transcript',
          SESSION_ID,
        ])
        if (!cached) throw new Error('expected a cached transcript')
        return cached.transcript
      }
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.messages).toHaveLength(2))

      act(() => {
        testTransport().fail()
        testTransport().connected()
      })

      await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

      for (let attempt = 0; attempt < 4; attempt += 1) {
        act(() => {
          if (attempt === 0) {
            testTransport().message(textGrowthSequence[0])
            testTransport().message(textGrowthSequence[1])
          }
          testTransport().message(streamed[attempt])
        })
        flushFrames()
        await act(async () => {
          reads[attempt]?.resolve(overlapped[attempt] as SnapshotValue)
        })
        if (attempt < 3) {
          await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(attempt + 3))
        }
      }

      expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(5)
      expect(cachedTranscript().messages[1]?.content).toEqual([
        { type: 'text', text: 'Hello world!?' },
      ])

      await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(6))

      await act(async () => {
        reads[4]?.resolve(authoritative)
      })

      await waitFor(() => expect(result.current.messages).toHaveLength(3))
      expect(result.current.messages.map((message) => message.id)).toEqual([
        USER_INBOX_ID,
        ASSISTANT_MESSAGE_ID,
        messageID(300),
      ])
      expect(result.current.status).toBe('idle')
    } finally {
      requestAnimationFrame.mockRestore()
    }
  })

  it('keeps one failed compaction when overlapping reads settle on the authoritative transcript', async () => {
    const frames: FrameRequestCallback[] = []
    const requestAnimationFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    const flushFrames = () => {
      act(() => {
        frames.splice(0).forEach((frame) => frame(0))
      })
    }
    const failedCompaction: SessionMessageInfo = {
      id: messageID(53),
      type: 'compaction',
      status: 'failed',
      reason: 'manual',
      error: { type: 'compaction.failed', message: 'provider unavailable' },
      time: { created: 5030 },
    }
    const failedSnapshot: SnapshotValue = {
      messages: [...seededMessages, failedCompaction],
      pending: [],
      status: 'idle',
    }
    const reads = [0, 1, 2, 3, 4].map(() => deferred<SnapshotValue>())
    const authoritative: SnapshotValue = {
      messages: [
        ...failedSnapshot.messages,
        {
          id: messageID(300),
          type: 'synthetic',
          text: 'Server only',
          time: { created: 30000 },
        },
      ],
      pending: [],
      status: 'idle',
    }
    mocks.readSessionSnapshot
      .mockResolvedValueOnce(failedSnapshot)
      .mockReturnValueOnce(reads[0].promise)
      .mockReturnValueOnce(reads[1].promise)
      .mockReturnValueOnce(reads[2].promise)
      .mockReturnValueOnce(reads[3].promise)
      .mockReturnValueOnce(reads[4].promise)
    try {
      const queryClient = createQueryClient()
      const cachedTranscript = () => {
        const cached = queryClient.getQueryData<{ transcript: SessionTranscript }>([
          'opencode',
          'transcript',
          SESSION_ID,
        ])
        if (!cached) throw new Error('expected a cached transcript')
        return cached.transcript
      }
      const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.messages).toHaveLength(3))

      act(() => {
        testTransport().fail()
        testTransport().connected()
      })

      await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

      for (let attempt = 0; attempt < 4; attempt += 1) {
        act(() => {
          if (attempt === 0) {
            testTransport().message(failedCompactionSequence[0])
          } else if (attempt < 3) {
            testTransport().message(compactionSequence[1])
          } else {
            testTransport().message(failedCompactionSequence[1])
          }
        })
        flushFrames()
        await act(async () => {
          reads[attempt]?.resolve(failedSnapshot)
        })
        if (attempt < 3) {
          await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(attempt + 3))
        }
      }

      expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(5)
      expect(
        cachedTranscript().messages.filter((message) => message.type === 'compaction'),
      ).toEqual([failedCompaction])

      await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(6))

      await act(async () => {
        reads[4]?.resolve(authoritative)
      })

      await waitFor(() => expect(result.current.messages).toHaveLength(4))
      expect(result.current.messages.filter((message) => message.type === 'compaction')).toEqual([
        failedCompaction,
      ])
      expect(result.current.messages.some((message) => message.id === messageID(300))).toBe(true)
      expect(result.current.status).toBe('idle')
    } finally {
      requestAnimationFrame.mockRestore()
    }
  })

  it('discards an older-page response superseded by a newest-page read', async () => {
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [],
      status: 'idle',
      nextCursor: 'cursor_1',
    })
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.hasOlder).toBe(true))

    const olderPage = deferred<{ messages: SessionMessageInfo[]; nextCursor: string }>()
    mocks.listSessionMessages.mockReturnValue(olderPage.promise)
    let older: Promise<void> | undefined
    act(() => {
      older = result.current.fetchOlder()
    })
    expect(mocks.listSessionMessages).toHaveBeenCalledWith(SESSION_ID, { cursor: 'cursor_1' })

    const reconnectRead = deferred<{
      messages: SessionMessageInfo[]
      pending: SessionInboxInfo[]
      status: 'idle'
      nextCursor: string
    }>()
    mocks.readSessionSnapshot.mockReturnValue(reconnectRead.promise)

    act(() => {
      testTransport().fail()
      testTransport().connected()
    })

    await waitFor(() => expect(mocks.readSessionSnapshot).toHaveBeenCalledTimes(2))

    await act(async () => {
      reconnectRead.resolve({
        messages: seededMessages,
        pending: [],
        status: 'idle',
        nextCursor: 'cursor_2',
      })
    })

    const olderMessage: SessionMessageInfo = {
      id: messageID(0),
      type: 'synthetic',
      text: 'Earlier',
      time: { created: 900 },
    }
    await act(async () => {
      olderPage.resolve({ messages: [olderMessage], nextCursor: 'cursor_3' })
      await older
    })

    expect(result.current.messages.map((message) => message.id)).toEqual([
      USER_INBOX_ID,
      ASSISTANT_MESSAGE_ID,
    ])

    mocks.listSessionMessages.mockResolvedValue({ messages: [] })
    await act(async () => {
      await result.current.fetchOlder()
    })

    expect(mocks.listSessionMessages).toHaveBeenLastCalledWith(SESSION_ID, { cursor: 'cursor_2' })
  })

  it('loads older pages with fetchOlder until the cursor is exhausted', async () => {
    mocks.readSessionSnapshot.mockResolvedValue({
      messages: seededMessages,
      pending: [],
      status: 'idle',
      nextCursor: 'cursor_1',
    })
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
    mocks.listSessionMessages.mockResolvedValueOnce({ messages: [olderMessage] })

    await act(async () => {
      await result.current.fetchOlder()
    })

    expect(mocks.listSessionMessages).toHaveBeenLastCalledWith(SESSION_ID, { cursor: 'cursor_1' })
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
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
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
      promptSequence.slice(0, 2).forEach((event) => testTransport().message(event))
      textStreamSequence.slice(0, 2).forEach((event) => testTransport().message(event))
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
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionTranscript(SESSION_ID, DIRECTORY), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))

    act(() => {
      testTransport().message({
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
    const pageMessages: { current: SessionMessageInfo[] } = { current: [] }

    function PageConsumers() {
      const { messages } = useSessionTranscript(SESSION_ID, DIRECTORY)
      pageMessages.current = messages
      return (
        <ContextUsageIndicator
          directory={DIRECTORY}
          sessionID={SESSION_ID}
          isConnected
        />
      )
    }

    render(<PageConsumers />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(pageMessages.current).toHaveLength(2))

    act(() => {
      testTransport().message(textStreamSequence[1])
      testTransport().message(textStreamSequence[2])
      testTransport().message(promptSequence[7])
      testTransport().message(promptSequence[8])
      testTransport().message(promptSequence[11])
      testTransport().message(promptSequence[12])
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
