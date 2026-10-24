import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenCodeServers } from './useOpenCodeServers'

const mocks = vi.hoisted(() => ({ listOpenCodeServers: vi.fn() }))

vi.mock('@/api/opencodeServers', () => ({
  listOpenCodeServers: mocks.listOpenCodeServers,
  listOpenCodeServerStatuses: vi.fn(),
  createOpenCodeServer: vi.fn(),
  deleteOpenCodeServer: vi.fn(),
  testOpenCodeServer: vi.fn(),
  testOpenCodeServerById: vi.fn(),
  updateOpenCodeServer: vi.fn(),
}))

const kitchen = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useOpenCodeServers', () => {
  beforeEach(() => {
    mocks.listOpenCodeServers.mockReset()
  })

  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('reports an in-flight first load as initial loading', () => {
    mocks.listOpenCodeServers.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useOpenCodeServers(), { wrapper: createWrapper() })

    expect(result.current.isPaused).toBe(false)
    expect(result.current.showsInitialLoading).toBe(true)
  })

  it('reports a paused offline fetch as paused instead of initial loading', () => {
    onlineManager.setOnline(false)
    mocks.listOpenCodeServers.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useOpenCodeServers(), { wrapper: createWrapper() })

    expect(result.current.isPaused).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.servers).toEqual([])
    expect(result.current.showsInitialLoading).toBe(false)
    expect(mocks.listOpenCodeServers).not.toHaveBeenCalled()
  })

  it('keeps the cached server list and leaves it unloaded while a refetch is paused', async () => {
    mocks.listOpenCodeServers.mockResolvedValueOnce([kitchen]).mockReturnValueOnce(new Promise(() => {}))
    const wrapper = createWrapper()
    const { result } = renderHook(() => useOpenCodeServers(), { wrapper })

    await waitFor(() => expect(result.current.servers).toEqual([kitchen]))

    onlineManager.setOnline(false)
    act(() => {
      void result.current.refetch()
    })

    await waitFor(() => expect(result.current.isPaused).toBe(true))
    expect(result.current.servers).toEqual([kitchen])
    expect(result.current.showsInitialLoading).toBe(false)
  })
})
