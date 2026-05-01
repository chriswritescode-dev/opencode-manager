import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMessages } from '../useOpenCode'

const mocks = vi.hoisted(() => ({
  listMessages: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    listMessages: mocks.listMessages,
  })),
}))

describe('useMessages fallback poll', () => {
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

  it('should poll every 5s when fallbackPoll is enabled', async () => {
    vi.useFakeTimers()
    
    mocks.listMessages.mockResolvedValue([])

    renderHook(
      () => useMessages('http://localhost:5003', 'session-1', '/repo', { fallbackPoll: true }),
      { wrapper }
    )

    expect(mocks.listMessages).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    
    await waitFor(() => {
      expect(mocks.listMessages).toHaveBeenCalledTimes(2)
    })

    vi.useRealTimers()
  })

  it('should not poll when fallbackPoll is disabled', async () => {
    vi.useFakeTimers()
    
    mocks.listMessages.mockResolvedValue([])

    renderHook(
      () => useMessages('http://localhost:5003', 'session-1', '/repo', { fallbackPoll: false }),
      { wrapper }
    )

    expect(mocks.listMessages).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15000)
    
    expect(mocks.listMessages).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('should not poll by default (no opts)', async () => {
    vi.useFakeTimers()
    
    mocks.listMessages.mockResolvedValue([])

    renderHook(
      () => useMessages('http://localhost:5003', 'session-1', '/repo'),
      { wrapper }
    )

    expect(mocks.listMessages).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15000)
    
    expect(mocks.listMessages).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
