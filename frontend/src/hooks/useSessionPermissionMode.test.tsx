import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionPermissionMode, useSetSessionPermissionMode } from './useSessionPermissionMode'
import { getSessionPermissionMode, setSessionPermissionMode } from '@/api/sessionPermissionModes'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'

vi.mock('@/api/sessionPermissionModes', () => ({
  getSessionPermissionMode: vi.fn(),
  setSessionPermissionMode: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

function createWrapper(queryClient: QueryClient, serverId: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OpenCodeServerProvider serverId={serverId}>{children}</OpenCodeServerProvider>
    </QueryClientProvider>
  )
}

describe('useSessionPermissionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the mode for the current server and scopes its cache key', async () => {
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto' as const, lockedReason: null }
    vi.mocked(getSessionPermissionMode).mockResolvedValue(state)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useSessionPermissionMode('ses_1'), { wrapper: createWrapper(queryClient, 'srv_remote') })

    await waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('ses_1', 'srv_remote'))

    expect(queryClient.getQueryCache().find({ queryKey: ['session-permission-mode', 'ses_1', 'srv_remote'] })).toBeDefined()
  })

  it('writes the mode through the current server', async () => {
    const state = { sessionId: 'ses_1', rootSessionId: 'ses_1', mode: 'auto' as const, lockedReason: null }
    vi.mocked(setSessionPermissionMode).mockResolvedValue(state)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useSetSessionPermissionMode('ses_1'), {
      wrapper: createWrapper(queryClient, 'srv_remote'),
    })

    await act(async () => {
      await result.current.mutateAsync({ directory: '/repo', mode: 'auto' })
    })

    expect(setSessionPermissionMode).toHaveBeenCalledWith(
      'ses_1',
      { directory: '/repo', mode: 'auto' },
      'srv_remote',
    )
    expect(
      queryClient.getQueryData(['session-permission-mode', 'ses_1', 'srv_remote']),
    ).toEqual(state)
  })
})
