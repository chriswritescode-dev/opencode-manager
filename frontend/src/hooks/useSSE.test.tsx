import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from './useSSE'

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
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response))
  })

  afterEach(() => {
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
})
