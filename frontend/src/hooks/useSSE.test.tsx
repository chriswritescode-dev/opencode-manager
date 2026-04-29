import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'
import { useSessionStatus } from '../stores/sessionStatusStore'

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
})
