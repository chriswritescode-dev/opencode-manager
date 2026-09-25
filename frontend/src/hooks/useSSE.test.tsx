import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import { useSessionStatus } from '../stores/sessionStatusStore'
import { showToast } from '@/lib/toast'

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  listActiveSessions: mocks.active,
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
    mocks.active.mockResolvedValue({})
    useSessionStatus.getState().replaceStatuses({})
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response))
  })

  afterEach(() => {
    useSessionStatus.getState().replaceStatuses({})
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  })

  const createWrapper = (queryClient: QueryClient) => {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  const connect = async (index: number, clientId: string) => {
    act(() => {
      MockEventSource.instances[index].emit('connected', { clientId })
    })
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(index + 1))
  }

  it('invalidates active session data after reconnecting', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    await connect(0, 'client-1')
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

    await connect(1, 'client-2')

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['opencode', 'session', 'session-1', '/repo'],
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['opencode', 'pending-actions', 'session-1', '/repo'],
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

    useSessionStatus.getState().setStatus('session-1', { type: 'busy' })

    const { unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    await connect(0, 'client-1')

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
    })

    unmount()
  })

  it('preserves optimistic active status when a poll snapshot omits the session', () => {
    useSessionStatus.getState().setOptimisticActive('session-1', 10_000)

    useSessionStatus.getState().replaceStatuses({})

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })

    useSessionStatus.getState().replaceStatuses({
      'session-1': { type: 'idle' },
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
  })

  it('ignores stale status snapshots after the directory changes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    let resolveRepoA: (value: Record<string, { type: 'running' }>) => void = () => {}
    let resolveRepoB: (value: Record<string, { type: 'running' }>) => void = () => {}
    mocks.active
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoA = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRepoB = resolve }))

    const { rerender, unmount } = renderHook(
      ({ directory }) => useSSE(directory, 'session-1'),
      { wrapper: createWrapper(queryClient), initialProps: { directory: '/repo-a' } }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))

    await connect(0, 'client-1')

    rerender({ directory: '/repo-b' })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    await connect(1, 'client-2')

    await act(async () => {
      resolveRepoB({ 'session-b': { type: 'running' } })
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    })

    await act(async () => {
      resolveRepoA({ 'session-a': { type: 'running' } })
    })

    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })

    unmount()
  })

  it('invalidates the session list and cached session query on session.created', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'session', 'session-2', '/repo'], { id: 'session-2' })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.created',
        directory: '/repo',
        data: { sessionID: 'session-2', projectID: 'proj-1', slug: 'slug', location: { directory: '/repo' } },
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session', 'session-2'] })
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('invalidates the session list and cached session query on session.renamed', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'session', 'session-2', '/repo'], { id: 'session-2' })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.renamed',
        directory: '/repo',
        data: { sessionID: 'session-2', title: 'Renamed' },
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session', 'session-2'] })
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('invalidates the session list and removes the session query on session.deleted', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    queryClient.setQueryData(['opencode', 'session', 'session-2', '/repo'], { id: 'session-2' })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.deleted',
        directory: '/repo',
        data: { sessionID: 'session-2' },
      })
    })

    await waitFor(() => {
      expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session', 'session-2'] })
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('invalidates the session list on session.moved', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.moved',
        directory: '/repo',
        data: { sessionID: 'session-2', projectID: 'proj-1', location: { directory: '/repo-2' } },
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ predicate: expect.any(Function) }),
      )
    })

    unmount()
  })

  it('reconciles model and agent selection events into the cached session', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    queryClient.setQueryData(['opencode', 'session', 'session-2', '/repo'], {
      id: 'session-2',
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude' },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.model.selected',
        directory: '/repo',
        data: { sessionID: 'session-2', model: { providerID: 'openai', id: 'gpt-4' } },
      })
      MockEventSource.instances[0].emit('message', {
        type: 'session.agent.selected',
        directory: '/repo',
        data: { sessionID: 'session-2', agent: 'plan' },
      })
    })

    expect(queryClient.getQueryData(['opencode', 'session', 'session-2', '/repo'])).toMatchObject({
      model: { providerID: 'openai', id: 'gpt-4' },
      agent: 'plan',
    })

    unmount()
  })

  it('patches the cached session revert from revert lifecycle events', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const sessionKey = ['opencode', 'session', 'session-1', '/repo']
    queryClient.setQueryData(sessionKey, { id: 'session-1' })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.revert.staged',
        directory: '/repo',
        data: { sessionID: 'session-1', revert: { messageID: 'message-3' } },
      })
    })

    expect(queryClient.getQueryData(sessionKey)).toMatchObject({ revert: { messageID: 'message-3' } })

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.revert.cleared',
        directory: '/repo',
        data: { sessionID: 'session-1' },
      })
    })

    expect(queryClient.getQueryData<{ revert?: unknown }>(sessionKey)?.revert).toBeUndefined()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.revert.staged',
        directory: '/repo',
        data: { sessionID: 'session-1', revert: { messageID: 'message-4' } },
      })
      MockEventSource.instances[0].emit('message', {
        type: 'session.revert.committed',
        directory: '/repo',
        data: { sessionID: 'session-1' },
      })
    })

    expect(queryClient.getQueryData<{ revert?: unknown }>(sessionKey)?.revert).toBeUndefined()

    unmount()
  })

  it('refreshes session lists and the current session on an upstream resync without re-reading pending actions', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      MockEventSource.instances[0].emit('resync', { timestamp: Date.now() })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['opencode', 'session', 'session-1', '/repo'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ predicate: expect.any(Function) }),
    )
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['opencode', 'pending-actions', 'session-1', '/repo'],
    })

    unmount()
  })

  it('handles envelopes whose directory is null', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        directory: null,
        payload: { type: 'session.execution.started', data: { sessionID: 'session-9' } },
      })
    })

    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'busy' })

    unmount()
  })

  it('applies session.status and session.idle to the status store', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.status',
        directory: '/repo',
        data: { sessionID: 'session-1', status: { type: 'busy' } },
      })
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'session.idle',
        directory: '/repo',
        data: { sessionID: 'session-1' },
      })
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    unmount()
  })

  it('applies session execution lifecycle events to the status store', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    const emit = (type: string, data: Record<string, unknown>) => {
      act(() => {
        MockEventSource.instances[0].emit('message', { type, directory: '/repo', data })
      })
    }

    emit('session.execution.started', { sessionID: 'session-1' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })

    emit('session.execution.succeeded', { sessionID: 'session-1' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    emit('session.execution.started', { sessionID: 'session-1' })
    emit('session.execution.failed', { sessionID: 'session-1', error: { message: 'failed' } })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    emit('session.execution.started', { sessionID: 'session-1' })
    emit('session.execution.interrupted', { sessionID: 'session-1', reason: 'user' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    unmount()
  })

  it('ignores message, todo, and form events', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()
    setQueryData.mockClear()

    act(() => {
      const events = [
        { type: 'message.updated', data: { info: { id: 'message-1', sessionID: 'session-1' } } },
        { type: 'message.removed', data: { sessionID: 'session-1', messageID: 'message-1' } },
        { type: 'todo.updated', data: { sessionID: 'session-1', todos: [] } },
        { type: 'form.replied', data: { id: 'form-1', sessionID: 'session-1', answer: {} } },
        { type: 'form.cancelled', data: { id: 'form-1', sessionID: 'session-1' } },
      ]
      for (const event of events) {
        MockEventSource.instances[0].emit('message', { ...event, directory: '/repo' })
      }
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(setQueryData).not.toHaveBeenCalled()

    unmount()
  })

  it('invalidates the session list on terminal execution, metadata, and usage events', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    const emit = (type: string, data: Record<string, unknown>) => {
      act(() => {
        MockEventSource.instances[0].emit('message', { type, directory: '/repo', data })
      })
    }

    for (const type of ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted']) {
      invalidateQueries.mockClear()
      emit(type, { sessionID: 'session-2' })
      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith(
          expect.objectContaining({ predicate: expect.any(Function) }),
        )
      })
    }

    for (const type of ['session.metadata.updated', 'session.usage.updated']) {
      invalidateQueries.mockClear()
      emit(type, { sessionID: 'session-2', metadata: {}, cost: 0, tokens: {} })
      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith(
          expect.objectContaining({ predicate: expect.any(Function) }),
        )
      })
    }

    unmount()
  })

  it('does not invalidate the session list on per-token delta events', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    invalidateQueries.mockClear()

    act(() => {
      for (const type of ['session.text.delta', 'session.reasoning.delta', 'session.tool.input.delta']) {
        MockEventSource.instances[0].emit('message', {
          type,
          directory: '/repo',
          data: { sessionID: 'session-2' },
        })
      }
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(invalidateQueries).not.toHaveBeenCalled()

    unmount()
  })

  it('does not show an update toast on installation.update-available', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'installation.update-available',
        directory: '/repo',
        data: { version: '2.0.0' },
      })
    })

    expect(showToast.info).not.toHaveBeenCalled()
    expect(showToast.loading).not.toHaveBeenCalled()

    unmount()
  })

  it('shows an updated toast on installation.updated', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'installation.updated',
        directory: '/repo',
        data: { version: '2.0.0' },
      })
    })

    expect(showToast.success).toHaveBeenCalled()

    unmount()
  })
})
