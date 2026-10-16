import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeWalkthroughQueryKey,
  useCancelChangeWalkthrough,
  useChangeWalkthrough,
  useGenerateChangeWalkthrough,
  useRefineChangeWalkthrough,
} from './useChangeWalkthrough'
import { DEFAULT_WALKTHROUGH_SOURCE } from '@opencode-manager/shared/schemas'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  getChangeWalkthrough: vi.fn(),
  generateChangeWalkthrough: vi.fn(),
  refineChangeWalkthrough: vi.fn(),
  cancelChangeWalkthrough: vi.fn(),
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
  refineChangeWalkthrough: mocks.refineChangeWalkthrough,
  cancelChangeWalkthrough: mocks.cancelChangeWalkthrough,
}))

const walkthroughForA: ChangeWalkthrough = {
  sessionId: 'ses_A',
  source: { kind: 'session' },
  diffHash: 'hash-a',
  walkthroughSessionId: 'ses_walk',
  status: 'ready',
  artifactPath: '/workspace/walkthroughs/ses_A/gen/index.html',
  publishedAt: 1,
  executionStartedAt: null,
  error: null,
  model: null,
  createdAt: 1,
  updatedAt: 2,
}

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return { walkthrough: null, currentDiffHash: 'hash-a', stale: false, generating: false, running: false, error: null, ...overrides }
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
      ({ sessionId }: { sessionId: string }) => useGenerateChangeWalkthrough(sessionId, DEFAULT_WALKTHROUGH_SOURCE),
      { initialProps: { sessionId: 'ses_A' }, wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate({})
    })
    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_A', { source: { kind: 'session' } })
    })

    rerender({ sessionId: 'ses_B' })

    await act(async () => {
      pending.resolve(state({ generating: true }))
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_A', 'session'))).toEqual(
        state({ generating: true }),
      )
    })
    expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_B', 'session'))).toBeUndefined()
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

      const { result } = renderHook(() => useChangeWalkthrough('ses_A', true, DEFAULT_WALKTHROUGH_SOURCE), {
        wrapper: createWrapper(queryClient),
      })

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

  it('keeps polling while a published walkthrough is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      mocks.getChangeWalkthrough
        .mockResolvedValueOnce(state({ walkthrough: walkthroughForA, running: true }))
        .mockResolvedValueOnce(state({ walkthrough: walkthroughForA }))

      const { result } = renderHook(() => useChangeWalkthrough('ses_A', true, DEFAULT_WALKTHROUGH_SOURCE), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.data?.running).toBe(true))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      await waitFor(() => expect(result.current.data?.running).toBe(false))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requests the walkthrough state for the session and source only', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getChangeWalkthrough.mockResolvedValue(state())

    renderHook(() => useChangeWalkthrough('ses_A', true, { kind: 'staged' }), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_A', { kind: 'staged' }))
  })

  it('invalidating the session key refetches every source', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getChangeWalkthrough.mockResolvedValue(state())

    renderHook(() => useChangeWalkthrough('ses_A', true, { kind: 'staged' }), {
      wrapper: createWrapper(queryClient),
    })
    renderHook(() => useChangeWalkthrough('ses_A', true, { kind: 'unstaged' }), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(2))

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey('ses_A') })
    })

    await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledTimes(4))
  })
})

describe('useRefineChangeWalkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the refine text for the source and caches the returned state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.refineChangeWalkthrough.mockResolvedValue(state({ generating: true }))

    const { result } = renderHook(() => useRefineChangeWalkthrough('ses_A', DEFAULT_WALKTHROUGH_SOURCE), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      result.current.mutate('tighten the introduction')
    })

    expect(mocks.refineChangeWalkthrough).toHaveBeenCalledWith('ses_A', {
      source: { kind: 'session' },
      text: 'tighten the introduction',
    })
    await waitFor(() => {
      expect(queryClient.getQueryData(changeWalkthroughQueryKey('ses_A', 'session'))).toEqual(
        state({ generating: true }),
      )
    })
  })
})

describe('useCancelChangeWalkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancels the walkthrough and optimistically clears the generating and running state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const queryKey = changeWalkthroughQueryKey('ses_A', 'session')
    queryClient.setQueryData(queryKey, state({ generating: true, running: true }))
    mocks.cancelChangeWalkthrough.mockResolvedValue(undefined)
    mocks.getChangeWalkthrough.mockResolvedValue(state())

    const { result } = renderHook(() => useCancelChangeWalkthrough('ses_A', DEFAULT_WALKTHROUGH_SOURCE), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      result.current.mutate()
    })

    expect(mocks.cancelChangeWalkthrough).toHaveBeenCalledWith('ses_A', { kind: 'session' })
    await waitFor(() => {
      expect(queryClient.getQueryData<ChangeWalkthroughState>(queryKey)?.generating).toBe(false)
    })
    expect(queryClient.getQueryData<ChangeWalkthroughState>(queryKey)?.running).toBe(false)
  })
})
