import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVcsInfo } from './useVcsInfo'

const mocks = vi.hoisted(() => ({ getVcsInfo: vi.fn() }))

vi.mock('@/api/opencode', () => ({ getVcsInfo: mocks.getVcsInfo }))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useVcsInfo', () => {
  beforeEach(() => {
    mocks.getVcsInfo.mockReset()
    mocks.getVcsInfo.mockResolvedValue({
      branch: { current: 'feat/header', default: 'main' },
    })
  })

  it('reads the branch of the directory from the given server', async () => {
    const { result } = renderHook(() => useVcsInfo('/abs/repo', 'srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data?.branch.current).toBe('feat/header'))
    expect(mocks.getVcsInfo).toHaveBeenCalledWith('/abs/repo', 'srv_kitchen')
  })

  it('stays disabled without a directory', () => {
    const { result } = renderHook(() => useVcsInfo(undefined, 'srv_kitchen'), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(mocks.getVcsInfo).not.toHaveBeenCalled()
  })

  it('stays disabled when the caller disables it', () => {
    renderHook(() => useVcsInfo('/abs/repo', 'srv_kitchen', { enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(mocks.getVcsInfo).not.toHaveBeenCalled()
  })

  it('shares one cache entry between callers of the same directory and server', async () => {
    const wrapper = createWrapper()
    const first = renderHook(() => useVcsInfo('/abs/repo', 'srv_kitchen'), { wrapper })
    const second = renderHook(() => useVcsInfo('/abs/repo', 'srv_kitchen'), { wrapper })

    await waitFor(() => expect(first.result.current.data?.branch.current).toBe('feat/header'))
    await waitFor(() => expect(second.result.current.data?.branch.current).toBe('feat/header'))

    expect(mocks.getVcsInfo).toHaveBeenCalledTimes(1)
  })
})
