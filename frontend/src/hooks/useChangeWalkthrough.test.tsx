import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeWalkthroughQueryKey, useChangeWalkthrough, useGenerateChangeWalkthrough } from './useChangeWalkthrough'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  getChangeWalkthrough: vi.fn(),
  generateChangeWalkthrough: vi.fn(),
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
}))

const walkthroughForA: ChangeWalkthrough = {
  sessionId: 'ses_A',
  diffHash: 'hash-a',
  summary: 'A summary',
  stops: [],
  hunks: [],
  omittedFiles: [],
  createdAt: 1,
}

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return { walkthrough: null, currentDiffHash: 'hash-a', stale: false, generating: false, error: null, ...overrides }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const createWrapper = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

describe('useGenerateChangeWalkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caches the returned state under the originating session when the session changes mid-flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pending = deferred<ChangeWalkthroughState>()
    mocks.generateChangeWalkthrough.mockReturnValue(pending.promise)

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useGenerateChangeWalkthrough(sessionId),
      { initialProps: { sessionId: 'ses_A' }, wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate({})
    })
    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_A', {})
    })

    rerender({ sessionId: 'ses_B' })

    await act(async () => {
      pending.resolve(state({ generating: true }))
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_A'))).toEqual(state({ generating: true }))
    })
    expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_B'))).toBeUndefined()
  })
})

describe('useChangeWalkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('polls while a generation is running and stops once it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      mocks.getChangeWalkthrough
        .mockResolvedValueOnce(state({ generating: true }))
        .mockResolvedValueOnce(state({ walkthrough: walkthroughForA }))

      const { result } = renderHook(() => useChangeWalkthrough('ses_A', true), { wrapper: createWrapper(queryClient) })

      await waitFor(() => expect(result.current.data?.generating).toBe(true))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      await waitFor(() => expect(result.current.data?.walkthrough).toEqual(walkthroughForA))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
