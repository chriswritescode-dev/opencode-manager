import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  outputsQueryKey,
  useCancelOutput,
  useGenerateOutput,
  useOutputData,
  useOutputState,
  usePromoteOutputDefinition,
  useRefineOutput,
} from './useOutputs'
import {
  WALKTHROUGH_OUTPUT_DEFINITION,
  outputParamsKey,
} from '@opencode-manager/shared/schemas'
import type { OutputRecord, OutputState } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  getOutputHelperSessionIds: vi.fn(),
  getOutputState: vi.fn(),
  generateOutput: vi.fn(),
  refineOutput: vi.fn(),
  cancelOutput: vi.fn(),
  getOutputData: vi.fn(),
  listOutputDefinitions: vi.fn(),
  createOutputDefinition: vi.fn(),
  putOutputDefinition: vi.fn(),
  deleteOutputDefinition: vi.fn(),
  promoteOutputDefinition: vi.fn(),
}))

vi.mock('@/api/outputs', () => ({
  getOutputHelperSessionIds: mocks.getOutputHelperSessionIds,
  getOutputState: mocks.getOutputState,
  generateOutput: mocks.generateOutput,
  refineOutput: mocks.refineOutput,
  cancelOutput: mocks.cancelOutput,
  getOutputData: mocks.getOutputData,
}))

vi.mock('@/api/outputDefinitions', () => ({
  listOutputDefinitions: mocks.listOutputDefinitions,
  createOutputDefinition: mocks.createOutputDefinition,
  putOutputDefinition: mocks.putOutputDefinition,
  deleteOutputDefinition: mocks.deleteOutputDefinition,
  promoteOutputDefinition: mocks.promoteOutputDefinition,
}))

const outputRecord: OutputRecord = {
  sessionId: 'ses_A',
  definitionId: 'walkthrough',
  paramsKey: '{}',
  params: {},
  inputHash: 'hash-1',
  generatorSessionId: 'ses_gen',
  status: 'ready',
  outputDir: '/workspace/outputs/ses_A/gen',
  publishedAt: 1000,
  executionStartedAt: null,
  error: null,
  model: null,
  createdAt: 1,
  updatedAt: 2,
}

function state(overrides: Partial<OutputState> = {}): OutputState {
  return {
    definition: WALKTHROUGH_OUTPUT_DEFINITION,
    output: null,
    currentInputHash: 'hash-1',
    hasInput: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
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

describe('useGenerateOutput', () => {
  it('caches the returned state under the originating session when the session changes mid-flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pending = deferred<OutputState>()
    mocks.generateOutput.mockReturnValue(pending.promise)

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useGenerateOutput(sessionId, 'walkthrough', {}),
      { initialProps: { sessionId: 'ses_A' }, wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate({})
    })
    await waitFor(() => {
      expect(mocks.generateOutput).toHaveBeenCalledWith('ses_A', {
        definitionId: 'walkthrough',
        params: {},
      })
    })

    rerender({ sessionId: 'ses_B' })

    await act(async () => {
      pending.resolve(state({ generating: true }))
    })

    const outputParams = outputParamsKey({})
    await waitFor(() => {
      expect(queryClient.getQueryData(outputsQueryKey('ses_A', 'walkthrough', outputParams))).toEqual(
        state({ generating: true }),
      )
    })
    expect(
      queryClient.getQueryData(outputsQueryKey('ses_B', 'walkthrough', outputParams)),
    ).toBeUndefined()
  })
})

describe('useOutputState', () => {
  it('polls while a generation is running and stops once it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      mocks.getOutputState
        .mockResolvedValueOnce(state({ generating: true }))
        .mockResolvedValueOnce(state({ output: outputRecord }))

      const params = { source: { kind: 'staged' } }
      const { result } = renderHook(() => useOutputState('ses_A', 'walkthrough', params), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.data?.generating).toBe(true))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      await waitFor(() => expect(result.current.data?.output).toEqual(outputRecord))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(mocks.getOutputState).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps polling while a published output is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      mocks.getOutputState
        .mockResolvedValueOnce(state({ output: outputRecord, running: true }))
        .mockResolvedValueOnce(state({ output: outputRecord }))

      const params = { source: { kind: 'staged' } }
      const { result } = renderHook(() => useOutputState('ses_A', 'walkthrough', params), {
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
      expect(mocks.getOutputState).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requests the output state for the session, definition and params only', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getOutputState.mockResolvedValue(state())

    const params = { source: { kind: 'staged' } }
    renderHook(() => useOutputState('ses_A', 'walkthrough', params), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() =>
      expect(mocks.getOutputState).toHaveBeenCalledWith('ses_A', 'walkthrough', {
        source: { kind: 'staged' },
      }),
    )
  })

  it('invalidating the session key refetches every params key', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getOutputState.mockResolvedValue(state())

    renderHook(() => useOutputState('ses_A', 'walkthrough', { source: { kind: 'staged' } }), {
      wrapper: createWrapper(queryClient),
    })
    renderHook(() => useOutputState('ses_A', 'walkthrough', { source: { kind: 'unstaged' } }), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(mocks.getOutputState).toHaveBeenCalledTimes(2))

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: outputsQueryKey('ses_A') })
    })

    await waitFor(() => expect(mocks.getOutputState).toHaveBeenCalledTimes(4))
  })
})

describe('useRefineOutput', () => {
  it('sends the refine text and caches the returned state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.refineOutput.mockResolvedValue(state({ generating: true }))

    const params = { source: { kind: 'staged' } }
    const { result } = renderHook(() => useRefineOutput('ses_A', 'walkthrough', params), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      result.current.mutate('tighten the introduction')
    })

    expect(mocks.refineOutput).toHaveBeenCalledWith('ses_A', {
      definitionId: 'walkthrough',
      params: { source: { kind: 'staged' } },
      text: 'tighten the introduction',
    })
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          outputsQueryKey('ses_A', 'walkthrough', outputParamsKey(params)),
        ),
      ).toEqual(state({ generating: true }))
    })
  })
})

describe('useCancelOutput', () => {
  it('cancels the output and optimistically clears the generating and running state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const params = { source: { kind: 'staged' } }
    const queryKey = outputsQueryKey('ses_A', 'walkthrough', outputParamsKey(params))
    queryClient.setQueryData(queryKey, state({ generating: true, running: true }))
    mocks.cancelOutput.mockResolvedValue(undefined)

    const { result } = renderHook(() => useCancelOutput('ses_A', 'walkthrough', params), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      result.current.mutate()
    })

    expect(mocks.cancelOutput).toHaveBeenCalledWith('ses_A', 'walkthrough', {
      source: { kind: 'staged' },
    })
    await waitFor(() => {
      expect(queryClient.getQueryData<OutputState>(queryKey)?.generating).toBe(false)
    })
    expect(queryClient.getQueryData<OutputState>(queryKey)?.running).toBe(false)
  })
})

describe('useOutputData', () => {
  it('fetches the published output data and stays disabled for an unpublished output', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getOutputData.mockResolvedValue({ title: 'Walkthrough' })

    const { result } = renderHook(() => useOutputData(outputRecord), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() =>
      expect(mocks.getOutputData).toHaveBeenCalledWith('/workspace/outputs/ses_A/gen'),
    )
    await waitFor(() => expect(result.current.data).toEqual({ title: 'Walkthrough' }))

    renderHook(() => useOutputData({ ...outputRecord, publishedAt: null }), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {})
    expect(mocks.getOutputData).toHaveBeenCalledTimes(1)
  })
})

describe('usePromoteOutputDefinition', () => {
  it('promotes the definition and invalidates every output definition query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.promoteOutputDefinition.mockResolvedValue(WALKTHROUGH_OUTPUT_DEFINITION)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => usePromoteOutputDefinition('ses_A'), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      result.current.mutate({ id: 'walkthrough' })
    })

    expect(mocks.promoteOutputDefinition).toHaveBeenCalledWith({
      sessionId: 'ses_A',
      id: 'walkthrough',
      replace: undefined,
    })
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['output-definitions'] }),
    )
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
