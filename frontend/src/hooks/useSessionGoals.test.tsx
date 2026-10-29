import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalState, SessionGoalRead } from '@opencode-manager/shared/opencode'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { showToast } from '@/lib/toast'
import { applySessionGoalEvent, useSessionGoal, useSessionGoalCommand } from './useSessionGoals'

const mocks = vi.hoisted(() => ({
  getSessionGoal: vi.fn(),
  runCommand: vi.fn(),
  syncSelection: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  getSessionGoal: mocks.getSessionGoal,
  runCommand: mocks.runCommand,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSyncSessionSelection: () => mocks.syncSelection,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

const goal: GoalState = {
  id: 'goal_1',
  objective: 'Ship the feature',
  status: 'active',
  rounds: 2,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1,
}

const updatedGoal: GoalState = { ...goal, rounds: 3 }

const supportedGoal: SessionGoalRead = { supported: true, goal }

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient: QueryClient, serverId?: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {serverId ? <OpenCodeServerProvider serverId={serverId}>{children}</OpenCodeServerProvider> : children}
    </QueryClientProvider>
  )
}

describe('useSessionGoal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionGoal.mockResolvedValue(supportedGoal)
  })

  it('reads the goal from the local server', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionGoal('ses_1', '/repo'), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    expect(mocks.getSessionGoal).toHaveBeenCalledWith('ses_1', '/repo', 'local')
  })

  it('reads the goal from the current remote server and scopes its cache key', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionGoal('ses_1', '/repo'), {
      wrapper: createWrapper(queryClient, 'srv_remote'),
    })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    expect(mocks.getSessionGoal).toHaveBeenCalledWith('ses_1', '/repo', 'srv_remote')
    expect(queryClient.getQueryCache().find({ queryKey: ['session-goal', 'ses_1', 'srv_remote'] })).toBeDefined()
  })

  it('does not poll for goal updates', async () => {
    vi.useFakeTimers()
    try {
      const queryClient = createQueryClient()
      renderHook(() => useSessionGoal('ses_1', '/repo'), { wrapper: createWrapper(queryClient) })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(mocks.getSessionGoal).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('applySessionGoalEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionGoal.mockResolvedValue(supportedGoal)
  })

  it('updates the cached goal without refetching', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionGoal('ses_1', '/repo'), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    let applied = false
    await act(async () => {
      applied = applySessionGoalEvent(
        queryClient,
        { type: 'rpc.opencode.goal.changed', data: { sessionID: 'ses_1', goal: updatedGoal } },
        'local',
      )
    })

    expect(applied).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ supported: true, goal: updatedGoal }))
    expect(mocks.getSessionGoal).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated events and leaves the cached goal unchanged', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSessionGoal('ses_1', '/repo'), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    let applied = true
    await act(async () => {
      applied = applySessionGoalEvent(queryClient, { type: 'session.idle', data: { sessionID: 'ses_1' } }, 'local')
    })

    expect(applied).toBe(false)
    expect(result.current.data).toEqual(supportedGoal)
    expect(mocks.getSessionGoal).toHaveBeenCalledTimes(1)
  })

  it('writes the change under the event server scoped key', async () => {
    const queryClient = createQueryClient()

    await act(async () => {
      applySessionGoalEvent(
        queryClient,
        { type: 'rpc.opencode.goal.changed', data: { sessionID: 'ses_1', goal: updatedGoal } },
        'srv_remote',
      )
    })

    expect(queryClient.getQueryData(['session-goal', 'ses_1', 'srv_remote'])).toEqual({
      supported: true,
      goal: updatedGoal,
    })
    expect(queryClient.getQueryData(['session-goal', 'ses_1'])).toBeUndefined()
  })

  it('keeps the event goal when an in-flight read resolves afterwards', async () => {
    const queryClient = createQueryClient()
    let resolveRead: (value: SessionGoalRead) => void = () => {}
    mocks.getSessionGoal.mockImplementation(
      () => new Promise<SessionGoalRead>((resolve) => {
        resolveRead = resolve
      }),
    )

    const { result } = renderHook(() => useSessionGoal('ses_1', '/repo'), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.getSessionGoal).toHaveBeenCalledTimes(1))

    act(() => {
      applySessionGoalEvent(
        queryClient,
        { type: 'rpc.opencode.goal.changed', data: { sessionID: 'ses_1', goal: updatedGoal } },
        'local',
      )
    })

    await waitFor(() => expect(result.current.data).toEqual({ supported: true, goal: updatedGoal }))

    await act(async () => {
      resolveRead(supportedGoal)
      await Promise.resolve()
    })

    expect(result.current.data).toEqual({ supported: true, goal: updatedGoal })
  })
})

describe('useSessionGoalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.syncSelection.mockResolvedValue(undefined)
  })

  it('runs the goal command on the session', async () => {
    const { result } = renderHook(() => useSessionGoalCommand('/repo'), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it' })
    })

    expect(mocks.runCommand).toHaveBeenCalledWith({ sessionID: 'ses_1', name: 'goal', text: 'Ship it' }, 'local')
  })

  it('syncs the session selection before running the goal command', async () => {
    const calls: string[] = []
    mocks.syncSelection.mockImplementation(async () => {
      calls.push('syncSelection')
    })
    mocks.runCommand.mockImplementation(async () => {
      calls.push('runCommand')
    })
    const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const { result } = renderHook(() => useSessionGoalCommand('/repo'), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it', model, agent: 'build' })
    })

    expect(mocks.syncSelection).toHaveBeenCalledWith({ sessionID: 'ses_1', model, agent: 'build' })
    expect(calls).toEqual(['syncSelection', 'runCommand'])
    expect(mocks.runCommand).toHaveBeenCalledWith({ sessionID: 'ses_1', name: 'goal', text: 'Ship it' }, 'local')
  })

  it('reports the command failure message', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('goal command failed'))
    const { result } = renderHook(() => useSessionGoalCommand('/repo'), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it' }).catch(() => undefined)
    })

    await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('goal command failed'))
  })
})
