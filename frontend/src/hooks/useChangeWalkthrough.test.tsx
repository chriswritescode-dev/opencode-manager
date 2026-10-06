import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeWalkthroughQueryKey, useChangeWalkthrough, useGenerateChangeWalkthrough } from './useChangeWalkthrough'
import type { ChangeWalkthrough } from '@opencode-manager/shared/schemas'

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

  it('caches a completed generation under the originating session when the session changes mid-flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pending = deferred<ChangeWalkthrough>()
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
      pending.resolve(walkthroughForA)
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_A'))).toEqual({
        walkthrough: walkthroughForA,
        currentDiffHash: 'hash-a',
        stale: false,
      })
    })
    expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_B'))).toBeUndefined()
  })

  it('refetches the state query after generation so server-computed staleness wins', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getChangeWalkthrough
      .mockResolvedValueOnce({ walkthrough: null, currentDiffHash: null, stale: false })
      .mockResolvedValueOnce({ walkthrough: walkthroughForA, currentDiffHash: 'hash-a', stale: true })
    mocks.generateChangeWalkthrough.mockResolvedValue(walkthroughForA)

    const { result } = renderHook(
      () => ({
        state: useChangeWalkthrough('ses_A', true),
        generate: useGenerateChangeWalkthrough('ses_A'),
      }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.generate.mutate({})
    })

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(result.current.state.data).toEqual({
        walkthrough: walkthroughForA,
        currentDiffHash: 'hash-a',
        stale: true,
      })
    })
  })
})
