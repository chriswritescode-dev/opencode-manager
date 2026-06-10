import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import { useSessionStatus } from '../stores/sessionStatusStore'
import type { MessageWithParts } from '@/api/types'
import { createTextPart } from '@/lib/partsBatcher'

const mocks = vi.hoisted(() => ({
  getSessionStatuses: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    getSessionStatuses: mocks.getSessionStatuses,
  })),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    reloadOpenCodeConfig: vi.fn(),
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor() {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {}

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners.get(type)?.forEach((listener) => listener(event))
    if (type === 'message' && this.onmessage) {
      this.onmessage(event)
    }
  }
}

describe('useSSE', () => {
  const originalEventSource = globalThis.EventSource
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    MockEventSource.instances = []
    mocks.getSessionStatuses.mockResolvedValue({})
    useSessionStatus.getState().replaceStatuses({})
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response))
  })

  afterEach(() => {
    useSessionStatus.getState().replaceStatuses({})
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  })

  it('invalidates active session data after reconnecting', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result, unmount } = renderHook(
      () => useSSE('http://localhost:5551', '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].onerror?.()
    })

    await waitFor(() => expect(result.current.isConnected).toBe(false))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    act(() => {
      MockEventSource.instances[1].emit('connected', { clientId: 'client-2' })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['opencode', 'session', 'http://localhost:5551', 'session-1', '/repo'],
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      })
    })

    unmount()
  })

  it('clears stale active statuses from the initial status snapshot', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    useSessionStatus.getState().setStatus('session-1', { type: 'busy' })

    const { unmount } = renderHook(
      () => useSSE('http://localhost:5551', '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
    })

    unmount()
  })

  it('ignores stale status snapshots after the directory changes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    let resolveRepoA: (value: Record<string, { type: 'busy' }>) => void = () => {}
    let resolveRepoB: (value: Record<string, { type: 'busy' }>) => void = () => {}
    mocks.getSessionStatuses
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoA = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoB = resolve }))

    const { rerender, unmount } = renderHook(
      ({ directory }) => useSSE('http://localhost:5551', directory, 'session-1'),
      { wrapper, initialProps: { directory: '/repo-a' } }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    act(() => {
      MockEventSource.instances[1].emit('connected', { clientId: 'client-2' })
    })

    await act(async () => {
      resolveRepoB({ 'session-b': { type: 'busy' } })
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    })

    await act(async () => {
      resolveRepoA({ 'session-a': { type: 'busy' } })
    })

    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })

    unmount()
  })

  it('sets single-session cache and invalidates session list on session.updated', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result, unmount } = renderHook(
      () => useSSE('http://localhost:5551', '/repo', 'session-1'),
      { wrapper }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))

    // Clear initial connection-related calls
    invalidateQueriesSpy.mockClear()
    setQueryDataSpy.mockClear()

    const sessionData = {
      id: 'session-2',
      projectID: 'proj-1',
      title: 'Updated Session',
      time: { created: 1000, updated: 2000 },
    }

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.updated',
        properties: { info: sessionData },
      })
    })

    await waitFor(() => {
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['opencode', 'session', 'http://localhost:5551', 'session-2', '/repo'],
        sessionData,
      )
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('clears optimistic active status when session status reports idle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [],
    )
    useSessionStatus.getState().setOptimisticActive('session-1')

    const { result, unmount } = renderHook(
      () => useSSE('http://localhost:5551', '/repo', 'session-1'),
      { wrapper },
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'client-1' })
    })

    await waitFor(() => expect(result.current.isConnected).toBe(true))
    useSessionStatus.getState().setOptimisticActive('session-1')

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.status',
        properties: {
          sessionID: 'session-1',
          status: { type: 'idle' },
        },
      })
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    unmount()
  })

  it('routes streamed part deltas to the event directory in multi-directory subscriptions', async () => {
    const origRAF = window.requestAnimationFrame
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof window.requestAnimationFrame

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })

      // Seed both directory caches before rendering the hook
      queryClient.setQueryData(
        ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-a'],
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('session-1', 'message-1', 'part-1', 'A')],
        }],
      )
      queryClient.setQueryData(
        ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-b'],
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('session-1', 'message-1', 'part-1', 'B')],
        }],
      )

      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )

      // Use stable reference to avoid re-render loop with inline array
      const directories = ['/repo-a', '/repo-b']
      const { result, unmount } = renderHook(
        () => useSSE('http://localhost:5551', directories, 'session-1'),
        { wrapper },
      )

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1)
      })

      const eventSource = MockEventSource.instances[MockEventSource.instances.length - 1]

      act(() => {
        eventSource.emit('connected', { clientId: 'client-1' })
      })

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      act(() => {
        eventSource.emit('message', {
          type: 'message.part.delta',
          directory: '/repo-b',
          properties: {
            sessionID: 'session-1',
            messageID: 'message-1',
            partID: 'part-1',
            field: 'text',
            delta: ' + streamed',
          },
        })
      })

      const repoBData = queryClient.getQueryData<MessageWithParts[]>([
        'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-b',
      ])
      expect(repoBData![0].parts[0]).toHaveProperty('text', 'B + streamed')

      const repoAData = queryClient.getQueryData<MessageWithParts[]>([
        'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-a',
      ])
      expect(repoAData![0].parts[0]).toHaveProperty('text', 'A')

      unmount()
    } finally {
      window.requestAnimationFrame = origRAF
    }
  })

  it('processes part deltas when directory transitions from undefined to a real value', async () => {
    const origRAF = window.requestAnimationFrame
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof window.requestAnimationFrame

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )

      // Seed cache with an empty part
      queryClient.setQueryData(
        ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
        [{
          ...assistantMessage('session-1', 'message-1'),
          parts: [createTextPart('session-1', 'message-1', 'part-1', '')],
        }],
      )

      // Initial render with directory=undefined — batcher should be created eagerly
      const { rerender, unmount } = renderHook(
        ({ directory }) => useSSE('http://localhost:5551', directory, 'session-1'),
        { wrapper, initialProps: { directory: undefined as string | undefined } },
      )

      // No SSE subscription yet because directoriesList is empty
      expect(MockEventSource.instances).toHaveLength(0)

      // Re-render with a real directory to start the SSE subscription
      rerender({ directory: '/repo' })

      await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
      const eventSource = MockEventSource.instances[0]

      act(() => {
        eventSource.emit('connected', { clientId: 'client-1' })
      })

      // Emit a part delta — the batcher was created on the initial mount,
      // so it should process the event even though directory was undefined at mount time
      act(() => {
        eventSource.emit('message', {
          type: 'message.part.delta',
          directory: '/repo',
          properties: {
            sessionID: 'session-1',
            messageID: 'message-1',
            partID: 'part-1',
            field: 'text',
            delta: 'streamed content',
          },
        })
      })

      await waitFor(() => {
        const data = queryClient.getQueryData<MessageWithParts[]>([
          'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
        ])
        expect(data![0].parts[0]).toHaveProperty('text', 'streamed content')
      })

      unmount()
    } finally {
      window.requestAnimationFrame = origRAF
    }
  })
})

function assistantMessage(sessionID: string, messageID: string): MessageWithParts {
  return {
    info: {
      id: messageID,
      sessionID,
      role: 'assistant',
      time: { created: Date.now() },
      parentID: '',
      modelID: 'test-model',
      providerID: 'test-provider',
      mode: 'test',
      agent: 'test-agent',
      path: { cwd: '/test', root: '/test' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  }
}
