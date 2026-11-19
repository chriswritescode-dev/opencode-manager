import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  changeWalkthroughQueryKey,
  useCancelChangeWalkthrough,
  useChangeWalkthrough,
  useGenerateChangeWalkthrough,
  useRefineChangeWalkthrough,
} from './useChangeWalkthrough'
import { DEFAULT_WALKTHROUGH_SOURCE } from '@opencode-manager/shared/schemas'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'
import { renderHookWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

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
  return {
    walkthrough: null,
    currentDiffHash: 'hash-a',
    hasChanges: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

function walkthroughRoute(
  path: string,
  method: FetchRoute['method'],
  respond: FetchRoute['respond'],
): FetchRoute {
  return { method, path, respond }
}

function pendingRoute(path: string, method: FetchRoute['method']) {
  let resolve: (result: FetchRouteResult) => void = () => {}
  const route = walkthroughRoute(path, method, () => new Promise<FetchRouteResult>((next) => {
    resolve = next
  }))
  return { route, resolve: (result: FetchRouteResult) => resolve(result) }
}

describe('useGenerateChangeWalkthrough', () => {
  it('caches the returned state under the originating session when the session changes mid-flight', async () => {
    const pending = pendingRoute('/api/change-walkthroughs/ses_A', 'POST')
    let sessionId = 'ses_A'
    const { result, rerender, queryClient, fetchFake } = renderHookWithProviders(
      () => useGenerateChangeWalkthrough(sessionId, DEFAULT_WALKTHROUGH_SOURCE),
      { ...hookProviders, fetchRoutes: [pending.route] },
    )

    act(() => {
      result.current.mutate({})
    })
    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/change-walkthroughs/ses_A')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/change-walkthroughs/ses_A')?.body).toEqual({
      source: { kind: 'session' },
    })

    sessionId = 'ses_B'
    rerender()

    await act(async () => {
      pending.resolve({ json: state({ generating: true }) })
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls while a generation is running and stops once it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    const route = walkthroughRoute('/api/change-walkthroughs/ses_A', 'GET', () => {
      calls += 1
      return calls === 1 ? { json: state({ generating: true }) } : { json: state({ walkthrough: walkthroughForA }) }
    })
    const { result, fetchFake } = renderHookWithProviders(
      () => useChangeWalkthrough('ses_A', true, DEFAULT_WALKTHROUGH_SOURCE),
      { ...hookProviders, fetchRoutes: [route] },
    )

    await waitFor(() => expect(result.current.data?.generating).toBe(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    await waitFor(() => expect(result.current.data?.walkthrough).toEqual(walkthroughForA))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchFake.findRequests('GET', '/api/change-walkthroughs/ses_A')).toHaveLength(2)
  })

  it('keeps polling while a published walkthrough is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    const route = walkthroughRoute('/api/change-walkthroughs/ses_A', 'GET', () => {
      calls += 1
      return calls === 1
        ? { json: state({ walkthrough: walkthroughForA, running: true }) }
        : { json: state({ walkthrough: walkthroughForA }) }
    })
    const { result, fetchFake } = renderHookWithProviders(
      () => useChangeWalkthrough('ses_A', true, DEFAULT_WALKTHROUGH_SOURCE),
      { ...hookProviders, fetchRoutes: [route] },
    )

    await waitFor(() => expect(result.current.data?.running).toBe(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    await waitFor(() => expect(result.current.data?.running).toBe(false))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchFake.findRequests('GET', '/api/change-walkthroughs/ses_A')).toHaveLength(2)
  })

  it('requests the walkthrough state for the session and source only', async () => {
    const { fetchFake } = renderHookWithProviders(
      () => useChangeWalkthrough('ses_A', true, { kind: 'staged' }),
      {
        ...hookProviders,
        fetchRoutes: [walkthroughRoute('/api/change-walkthroughs/ses_A', 'GET', () => ({ json: state() }))],
      },
    )

    await waitFor(() => expect(fetchFake.lastRequest('GET', '/api/change-walkthroughs/ses_A')).toBeDefined())
    expect(fetchFake.lastRequest('GET', '/api/change-walkthroughs/ses_A')?.searchParams.get('source')).toBe('staged')
  })

  it('invalidating the session key refetches every source', async () => {
    const { queryClient, fetchFake } = renderHookWithProviders(
      () => {
        useChangeWalkthrough('ses_A', true, { kind: 'staged' })
        useChangeWalkthrough('ses_A', true, { kind: 'unstaged' })
      },
      {
        ...hookProviders,
        fetchRoutes: [walkthroughRoute('/api/change-walkthroughs/ses_A', 'GET', () => ({ json: state() }))],
      },
    )

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/change-walkthroughs/ses_A')).toHaveLength(2))

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey('ses_A') })
    })

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/change-walkthroughs/ses_A')).toHaveLength(4))
  })
})

describe('useRefineChangeWalkthrough', () => {
  it('sends the refine text for the source and caches the returned state', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(
      () => useRefineChangeWalkthrough('ses_A', DEFAULT_WALKTHROUGH_SOURCE),
      {
        ...hookProviders,
        fetchRoutes: [
          walkthroughRoute('/api/change-walkthroughs/ses_A/refine', 'POST', () => ({
            json: state({ generating: true }),
          })),
        ],
      },
    )

    await act(async () => {
      result.current.mutate('tighten the introduction')
    })

    expect(fetchFake.lastRequest('POST', '/api/change-walkthroughs/ses_A/refine')?.body).toEqual({
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
  it('cancels the walkthrough and optimistically clears the generating and running state', async () => {
    const queryKey = changeWalkthroughQueryKey('ses_A', 'session')
    const { result, queryClient, fetchFake } = renderHookWithProviders(
      () => useCancelChangeWalkthrough('ses_A', DEFAULT_WALKTHROUGH_SOURCE),
      {
        ...hookProviders,
        fetchRoutes: [
          walkthroughRoute('/api/change-walkthroughs/ses_A', 'DELETE', () => ({ status: 204 })),
          walkthroughRoute('/api/change-walkthroughs/ses_A', 'GET', () => ({ json: state() })),
        ],
      },
    )
    queryClient.setQueryData(queryKey, state({ generating: true, running: true }))

    await act(async () => {
      result.current.mutate()
    })

    expect(fetchFake.lastRequest('DELETE', '/api/change-walkthroughs/ses_A')?.searchParams.get('source')).toBe('session')
    await waitFor(() => {
      expect(queryClient.getQueryData<ChangeWalkthroughState>(queryKey)?.generating).toBe(false)
    })
    expect(queryClient.getQueryData<ChangeWalkthroughState>(queryKey)?.running).toBe(false)
  })
})
