import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useRefreshMessage } from './useRemoveMessage'

const mocks = vi.hoisted(() => ({
  stageRevert: vi.fn(),
  commitRevert: vi.fn(),
  sendPrompt: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
}))

vi.mock('@/api/opencode', async () => {
  const actual = await vi.importActual('@/api/opencode')
  return {
    ...actual,
    stageRevert: mocks.stageRevert,
    commitRevert: mocks.commitRevert,
    sendPrompt: mocks.sendPrompt,
    switchSessionModel: mocks.switchSessionModel,
    switchSessionAgent: mocks.switchSessionAgent,
  }
})

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn(), success: vi.fn() },
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const sessionInfo = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-session',
  projectID: 'proj_1',
  time: { created: 1000, updated: 1000 },
  location: { directory: '/test' },
  agent: 'build',
  model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
  ...overrides,
})

describe('useRefreshMessage', () => {
  let queryClient: QueryClient

  const renderRefresh = () =>
    renderHook(() => useRefreshMessage({ sessionId: 'test-session', directory: '/test' }), {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })

  const setSession = (session: Record<string, unknown>) => {
    queryClient.setQueryData(['opencode', 'session', 'test-session', '/test'], session)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mocks.stageRevert.mockResolvedValue(undefined)
    mocks.commitRevert.mockResolvedValue(undefined)
    mocks.sendPrompt.mockResolvedValue({})
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
  })

  it('resends the edited text without synthesizing an agent attachment or unchanged switches', async () => {
    setSession(sessionInfo())

    const { result } = renderRefresh()

    await result.current.mutateAsync({
      assistantMessageID: 'assistant-1',
      userMessageContent: 'edited text',
      model: 'anthropic/claude-sonnet-4',
      agent: 'build',
    })

    expect(mocks.stageRevert).toHaveBeenCalledWith('test-session', 'assistant-1')
    expect(mocks.commitRevert).toHaveBeenCalledWith('test-session')
    expect(mocks.sendPrompt).toHaveBeenCalledWith({
      sessionID: 'test-session',
      text: 'edited text',
    })
    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
  })

  it('switches the model before resending when the edited message model changed', async () => {
    setSession(sessionInfo())

    const { result } = renderRefresh()

    await result.current.mutateAsync({
      assistantMessageID: 'assistant-1',
      userMessageContent: 'edited text',
      model: 'openai/gpt-4',
      agent: 'build',
    })

    expect(mocks.switchSessionModel).toHaveBeenCalledWith('test-session', {
      providerID: 'openai',
      id: 'gpt-4',
    })
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
    expect(mocks.switchSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendPrompt.mock.invocationCallOrder[0],
    )
  })

  it('switches the agent before resending when the selected agent changed', async () => {
    setSession(sessionInfo())

    const { result } = renderRefresh()

    await result.current.mutateAsync({
      assistantMessageID: 'assistant-1',
      userMessageContent: 'edited text',
      model: 'anthropic/claude-sonnet-4',
      agent: 'plan',
    })

    expect(mocks.switchSessionAgent).toHaveBeenCalledWith('test-session', 'plan')
    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
  })
})
