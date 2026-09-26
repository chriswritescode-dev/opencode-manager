import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenCodeApplyFeedback } from './useOpenCodeApplyFeedback'

const mocks = vi.hoisted(() => ({
  invalidateConfigCaches: vi.fn(),
  showToast: { success: vi.fn() },
}))

vi.mock('@/lib/queryInvalidation', () => ({
  invalidateConfigCaches: mocks.invalidateConfigCaches,
}))

vi.mock('@/lib/toast', () => ({
  showToast: mocks.showToast,
}))

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useOpenCodeApplyFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('announces the applied message and refreshes server caches when no restart is needed', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useOpenCodeApplyFeedback(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current({ appliedMessage: 'Configuration updated', restartRequired: false })
    })

    expect(mocks.showToast.success).toHaveBeenCalledWith('Configuration updated')
    expect(mocks.invalidateConfigCaches).toHaveBeenCalledWith(queryClient, { skipOpenCodeConfig: true })
  })

  it('points at the restart when the in-place reload failed', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useOpenCodeApplyFeedback(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current({ appliedMessage: 'Configuration updated', restartRequired: true })
    })

    expect(mocks.showToast.success).toHaveBeenCalledWith(
      'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.',
    )
    expect(mocks.invalidateConfigCaches).toHaveBeenCalledWith(queryClient, { skipOpenCodeConfig: true })
  })
})
