import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import { useSessionStatus } from '../stores/sessionStatusStore'
import { useSendErrorStore } from '../stores/sendErrorStore'
import { showToast } from '@/lib/toast'

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
    useSessionStatus.setState({ statuses: new Map(), statusCache: new Map(), statusRevisions: new Map(), knownSessions: new Set(), outcomes: new Map(), revision: 0 })
    useSendErrorStore.setState({ errors: {} })
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response))
  })

  afterEach(() => {
    useSessionStatus.setState({ statuses: new Map(), statusCache: new Map(), statusRevisions: new Map(), knownSessions: new Set(), outcomes: new Map(), revision: 0 })
    useSendErrorStore.setState({ errors: {} })
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
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'shells'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session-reconcile'] })
    })

    unmount()
  })

  it('invalidates the cached session query on session.created', async () => {
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
    })

    unmount()
  })

  it('invalidates the cached session query on session.renamed', async () => {
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
    })

    unmount()
  })

  it('removes the session query on session.deleted', async () => {
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
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'shells'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session-reconcile'] })

    unmount()
  })

  it('tracks background shells from shell lifecycle events without dropping completed shells', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const running = (id: string) => ({
      id,
      status: 'running',
      command: `sleep ${id}`,
      cwd: '/repo',
      shell: 'zsh',
      file: `/tmp/${id}.log`,
      metadata: { sessionID: 'session-1' },
      time: { started: 1 },
    })
    queryClient.setQueryData(['opencode', 'shells', '/repo'], [running('shell-1')])

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'shell.created',
        directory: '/repo',
        data: { info: running('shell-2') },
      })
      MockEventSource.instances[0].emit('message', {
        type: 'shell.exited',
        directory: '/repo',
        data: { id: 'shell-1', exit: 0, status: 'exited' },
      })
    })

    const shells = queryClient.getQueryData<Array<{ id: string; status: string; time: { completed?: number } }>>(
      ['opencode', 'shells', '/repo'],
    )
    expect(shells?.map((shell) => shell.id)).toEqual(['shell-1', 'shell-2'])
    expect(shells?.[0]?.status).toBe('exited')
    expect(shells?.[0]?.time.completed).toBeDefined()

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'shell.deleted',
        directory: '/repo',
        data: { id: 'shell-1' },
      })
    })

    const afterDelete = queryClient.getQueryData<Array<{ id: string; status: string }>>(['opencode', 'shells', '/repo'])
    expect(afterDelete?.map((shell) => shell.id)).toEqual(['shell-1', 'shell-2'])
    expect(afterDelete?.[0]?.status).toBe('exited')

    unmount()
  })

  it('keeps a deleted running shell visible as unavailable', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    queryClient.setQueryData(['opencode', 'shells', '/repo'], [
      {
        id: 'shell-1',
        status: 'running',
        command: 'sleep 1',
        cwd: '/repo',
        shell: 'zsh',
        file: '/tmp/shell-1.log',
        metadata: { sessionID: 'session-1' },
        time: { started: 1 },
      },
    ])

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'shell.deleted',
        directory: '/repo',
        data: { id: 'shell-1' },
      })
    })

    expect(
      queryClient.getQueryData<Array<{ id: string; status: string }>>(['opencode', 'shells', '/repo'])?.[0],
    ).toMatchObject({ id: 'shell-1', status: 'unavailable' })

    unmount()
  })

  it('does not discard a shell exit that arrives before the cache is seeded', async () => {
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
        type: 'shell.exited',
        directory: '/repo',
        data: { id: 'shell-1', exit: 0, status: 'exited' },
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'shells', '/repo'] })

    unmount()
  })

  it('does not resurrect a completed shell from a stale created event', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const shell = (status: string) => ({
      id: 'shell-1',
      status,
      command: 'sleep 1',
      cwd: '/repo',
      shell: 'zsh',
      file: '/tmp/shell-1.log',
      metadata: { sessionID: 'session-1' },
      time: { started: 1 },
    })
    queryClient.setQueryData(['opencode', 'shells', '/repo'], [
      { ...shell('exited'), exit: 0, time: { started: 1, completed: 2 } },
    ])

    const { result, unmount } = renderHook(
      () => useSSE('/repo', 'session-1'),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
    await connect(0, 'client-1')
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      MockEventSource.instances[0].emit('message', {
        type: 'shell.created',
        directory: '/repo',
        data: { info: shell('running') },
      })
    })

    expect(
      queryClient.getQueryData<Array<{ id: string; status: string }>>(['opencode', 'shells', '/repo'])?.[0]?.status,
    ).toBe('exited')

    unmount()
  })

  it('does not write session status from stream events', async () => {
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
      const events = [
        { type: 'session.status', directory: '/repo', data: { sessionID: 'session-1', status: { type: 'busy' } } },
        { type: 'session.execution.started', directory: '/repo', data: { sessionID: 'session-1' } },
        { type: 'session.idle', directory: '/repo', data: { sessionID: 'session-1' } },
      ]
      for (const event of events) {
        MockEventSource.instances[0].emit('message', event)
      }
    })

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })

    unmount()
  })

  it('clears the network send error on session.idle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Failed to send',
      message: 'Network error',
      kind: 'network',
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
        type: 'session.idle',
        directory: '/repo',
        data: { sessionID: 'session-1' },
      })
    })

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()

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
