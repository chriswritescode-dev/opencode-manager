import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionGoal } from './useSessionGoals'
import { getLatestSessionGoal } from '@/api/sessionGoals'
import type { SessionGoal, SessionGoalStatus } from '@opencode-manager/shared/schemas'

vi.mock('@/api/sessionGoals', () => ({
  getLatestSessionGoal: vi.fn(),
  startSessionGoal: vi.fn(),
  pauseSessionGoal: vi.fn(),
  resumeSessionGoal: vi.fn(),
  cancelSessionGoal: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

const baseGoal: SessionGoal = {
  id: 1,
  sessionId: 'ses_1',
  directory: '/repo',
  objective: 'Ship the feature',
  status: 'active',
  stopReason: null,
  turnState: 'running',
  continuationCount: 0,
  maxContinuations: 20,
  tokenBudget: null,
  tokensUsed: 0,
  consecutiveBlocked: 0,
  lastVerdict: null,
  lastReason: null,
  createdAt: 1,
  updatedAt: 1,
  finishedAt: null,
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useSessionGoal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('polls only while the goal is active', async () => {
    vi.mocked(getLatestSessionGoal).mockResolvedValue(baseGoal)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useSessionGoal('ses_1'), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(getLatestSessionGoal).toHaveBeenCalled())

    const query = queryClient.getQueryCache().find({ queryKey: ['session-goal', 'ses_1'] })
    const refetchInterval = query?.options.refetchInterval as
      | ((query: { state: { data?: { status: SessionGoalStatus } } }) => number | false)
      | undefined

    expect(refetchInterval).toBeTypeOf('function')
    expect(refetchInterval!({ state: { data: { status: 'active' } } })).toBe(3000)
    expect(refetchInterval!({ state: { data: { status: 'paused' } } })).toBe(false)
    expect(refetchInterval!({ state: { data: { status: 'completed' } } })).toBe(false)
    expect(refetchInterval!({ state: { data: { status: 'blocked' } } })).toBe(false)
    expect(refetchInterval!({ state: { data: { status: 'stopped' } } })).toBe(false)
    expect(refetchInterval!({ state: {} })).toBe(false)
  })
})
