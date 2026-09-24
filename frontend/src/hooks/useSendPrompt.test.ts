import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSendPrompt } from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'
import { sessionTranscriptQueryKey } from '../lib/queryInvalidation'
import { emptySessionTranscript } from '../lib/session-projection'
import type { SessionInboxUser } from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  sendPrompt: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
  setOptimisticActive: vi.fn(),
  clearStatus: vi.fn(),
  clearError: vi.fn(),
  setError: vi.fn(),
}))

vi.mock('../api/opencode', async () => {
  const actual = await vi.importActual('../api/opencode')
  return {
    ...actual,
    sendPrompt: mocks.sendPrompt,
    switchSessionModel: mocks.switchSessionModel,
    switchSessionAgent: mocks.switchSessionAgent,
  }
})

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: Object.assign(vi.fn(() => vi.fn()), {
    getState: () => ({
      setOptimisticActive: mocks.setOptimisticActive,
      clearStatus: mocks.clearStatus,
    }),
  }),
}))

vi.mock('../lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

vi.mock('../lib/opencode-errors', () => ({
  parseNetworkError: vi.fn((err) => ({
    title: 'Error',
    message: err.message,
    isRetryable: false,
  })),
  isGatewayTimeout: vi.fn((err) => err?.statusCode === 524),
}))

vi.mock('../stores/sendErrorStore', () => ({
  useSendErrorStore: {
    getState: () => ({
      clearError: mocks.clearError,
      setError: mocks.setError,
    }),
  },
}))

const inboxItem = (sessionID: string, text: string): SessionInboxUser => ({
  id: `inbox_${text}`,
  sessionID,
  time: { created: 1000 },
  type: 'user',
  payload: { text },
  delivery: 'queue',
})

const sessionInfo = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-session',
  projectID: 'proj_1',
  time: { created: 1000, updated: 1000 },
  location: { directory: '/test' },
  ...overrides,
})

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

describe('useSendPrompt', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mocks.sendPrompt.mockResolvedValue(inboxItem('test-session', 'Hello'))
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
  })

  const renderHookWithProviders = () =>
    renderHook(() => useSendPrompt('/test'), {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })

  const setSession = (session: Record<string, unknown>) => {
    queryClient.setQueryData(['opencode', 'session', 'test-session', '/test'], session)
  }

  it('sends a V2 prompt without switching when the model and agent match the session', async () => {
    setSession(sessionInfo({
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    }))

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID: 'test-session',
      text: 'Hello',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      agent: 'build',
    })

    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
    expect(mocks.sendPrompt).toHaveBeenCalledWith({
      sessionID: 'test-session',
      text: 'Hello',
      files: undefined,
      agents: undefined,
      skills: undefined,
      delivery: undefined,
    })
  })

  it('switches the model before prompting when the selection changed', async () => {
    setSession(sessionInfo({
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    }))

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID: 'test-session',
      text: 'Hello',
      model: { providerID: 'openai', id: 'gpt-4', variant: 'v1' },
      agent: 'build',
    })

    expect(mocks.switchSessionModel).toHaveBeenCalledWith('test-session', {
      providerID: 'openai',
      id: 'gpt-4',
      variant: 'v1',
    })
    expect(mocks.switchSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendPrompt.mock.invocationCallOrder[0],
    )
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
  })

  it('switches the agent before prompting when the selection changed', async () => {
    setSession(sessionInfo({
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    }))

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID: 'test-session',
      text: 'Hello',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      agent: 'plan',
    })

    expect(mocks.switchSessionAgent).toHaveBeenCalledWith('test-session', 'plan')
    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
  })

  it('switches back to a previously cached model after an intermediate switch', async () => {
    const modelA = { providerID: 'anthropic', id: 'claude-sonnet-4' }
    const modelB = { providerID: 'openai', id: 'gpt-4' }
    setSession(sessionInfo({ agent: 'build', model: modelA }))

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({ sessionID: 'test-session', text: 'first', model: modelB })
    await result.current.mutateAsync({ sessionID: 'test-session', text: 'second', model: modelA })

    expect(mocks.switchSessionModel.mock.calls).toEqual([
      ['test-session', modelB],
      ['test-session', modelA],
    ])
  })

  it('switches back to a previously cached agent after an intermediate switch', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({ sessionID: 'test-session', text: 'first', agent: 'plan' })
    await result.current.mutateAsync({ sessionID: 'test-session', text: 'second', agent: 'build' })

    expect(mocks.switchSessionAgent.mock.calls).toEqual([
      ['test-session', 'plan'],
      ['test-session', 'build'],
    ])
  })

  it('keeps the cached selection when a switch fails', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))
    mocks.switchSessionModel.mockRejectedValueOnce(new Error('switch failed'))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: { providerID: 'openai', id: 'gpt-4' },
      }),
    ).rejects.toThrow('switch failed')

    expect(
      queryClient.getQueryData<{ model?: unknown }>(['opencode', 'session', 'test-session', '/test'])?.model,
    ).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-4' })
  })

  it('keeps a successful model switch when the following agent switch fails', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))
    mocks.switchSessionAgent.mockRejectedValueOnce(new Error('agent switch failed'))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'test-session',
        text: 'Hello',
        model: { providerID: 'openai', id: 'gpt-4' },
        agent: 'plan',
      }),
    ).rejects.toThrow('agent switch failed')

    const cached = queryClient.getQueryData<{ model?: unknown; agent?: string }>([
      'opencode',
      'session',
      'test-session',
      '/test',
    ])
    expect(cached?.model).toEqual({ providerID: 'openai', id: 'gpt-4' })
    expect(cached?.agent).toBe('build')
  })

  it('adds the returned inbox item to the transcript pending state immediately', async () => {
    mocks.sendPrompt.mockResolvedValue(inboxItem('test-session', 'queued prompt'))
    queryClient.setQueryData(sessionTranscriptQueryKey('test-session'), {
      transcript: emptySessionTranscript,
    })

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID: 'test-session',
      text: 'queued prompt',
      delivery: 'queue',
    })

    const cached = queryClient.getQueryData<{
      transcript: { pending: SessionInboxUser[] }
    }>(sessionTranscriptQueryKey('test-session'))

    expect(cached?.transcript.pending.map((item) => item.id)).toEqual(['inbox_queued prompt'])
  })

  it('clears the stored send error on success', async () => {
    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID: 'session-1',
      text: 'Hello',
    })

    expect(mocks.clearError).toHaveBeenCalledWith('session-1')
  })

  it('stores the failed prompt for restoration on network failure', async () => {
    mocks.sendPrompt.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-lost',
        text: 'keep this prompt',
      })
    ).rejects.toThrow('Failed to fetch')

    expect(mocks.clearStatus).toHaveBeenCalledWith('session-lost')
    expect(mocks.setError).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'session-lost',
      failedPrompt: 'keep this prompt',
      kind: 'network',
    }))
  })

  it('surfaces no error on gateway timeout (524)', async () => {
    mocks.sendPrompt.mockRejectedValueOnce(new FetchError('Gateway timeout', 524))

    const { result } = renderHookWithProviders()

    await expect(
      result.current.mutateAsync({
        sessionID: 'session-524',
        text: 'long running prompt',
      })
    ).rejects.toThrow('Gateway timeout')

    expect(mocks.clearStatus).not.toHaveBeenCalled()
    expect(mocks.setError).not.toHaveBeenCalled()
  })

  it('invalidates the transcript query on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const sessionID = 'session-invalidate'

    const { result } = renderHookWithProviders()

    await result.current.mutateAsync({
      sessionID,
      text: 'Hello',
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: sessionTranscriptQueryKey(sessionID),
    })
  })
})
