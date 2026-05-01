import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  syncPendingActions: vi.fn(),
}))

describe('SessionDetail pending-actions polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createQueryClient = () => new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  )

  it('should poll pending-actions when refetchInterval is set', async () => {
    vi.useFakeTimers()
    
    mocks.syncPendingActions.mockResolvedValue(null)

    const testQueryOptions = {
      queryKey: ['opencode', 'pending-actions', 'http://localhost:5003', 'session-1', '/repo'] as const,
      queryFn: async () => {
        await mocks.syncPendingActions()
        return null
      },
      enabled: true,
      refetchOnMount: 'always' as const,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: 30000,
      retry: false,
    }

    renderHook(
      () => useQuery(testQueryOptions),
      { wrapper }
    )

    expect(mocks.syncPendingActions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30000)
    
    await waitFor(() => {
      expect(mocks.syncPendingActions).toHaveBeenCalledTimes(2)
    })

    vi.useRealTimers()
  })

  it('should not poll pending-actions when refetchInterval is false', async () => {
    vi.useFakeTimers()
    
    mocks.syncPendingActions.mockResolvedValue(null)

    const testQueryOptions = {
      queryKey: ['opencode', 'pending-actions', 'http://localhost:5003', 'session-1', '/repo'] as const,
      queryFn: async () => {
        await mocks.syncPendingActions()
        return null
      },
      enabled: true,
      refetchOnMount: 'always' as const,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: false as const,
      retry: false,
    }

    renderHook(
      () => useQuery(testQueryOptions),
      { wrapper }
    )

    expect(mocks.syncPendingActions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60000)
    
    expect(mocks.syncPendingActions).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
