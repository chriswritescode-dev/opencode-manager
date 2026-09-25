import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpServers } from './useMcpServers'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  addServer: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  startAuth: vi.fn(),
  removeAuth: vi.fn(),
}))

vi.mock('@/api/mcp', () => ({
  mcpApi: {
    getStatus: mocks.getStatus,
    addServer: mocks.addServer,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    startAuth: mocks.startAuth,
    removeAuth: mocks.removeAuth,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStatus.mockResolvedValue({})
    mocks.addServer.mockResolvedValue(undefined)
  })

  const createWrapper = (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

  it('invalidates session transcript caches through the shared predicate', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMcpServers(), { wrapper: createWrapper(queryClient) })

    await act(async () => {
      await result.current.addServerAsync({
        name: 'server',
        config: { type: 'local', command: ['echo'] },
      })
    })

    const predicateCall = invalidateQueries.mock.calls.find((call) => {
      const filters = call[0] as { predicate?: unknown } | undefined
      return typeof filters?.predicate === 'function'
    })
    const predicate = (predicateCall?.[0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean
    }).predicate

    expect(predicate({ queryKey: ['opencode', 'transcript', 'session-1'] })).toBe(true)
    expect(predicate({ queryKey: ['opencode', 'session', 'session-1'] })).toBe(true)
    expect(predicate({ queryKey: ['opencode', 'sessions', '/repo'] })).toBe(true)
    expect(predicate({ queryKey: ['opencode', 'messages', 'session-1'] })).toBe(false)
  })
})
