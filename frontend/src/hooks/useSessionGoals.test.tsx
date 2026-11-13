import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySessionGoalEvent, useSessionGoal, useSessionGoalCommand } from './useSessionGoals'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { GoalState, SessionGoalRead } from '@opencode-manager/shared/opencode'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

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

const goalReadPath = '/api/opencode/api/rpc/opencode.goal/get'

function goalRoute(respond: FetchRoute['respond'] = () => ({ json: { output: goal } })): FetchRoute {
  return { method: 'POST', path: goalReadPath, respond }
}

const commandRoute: FetchRoute = {
  method: 'POST',
  path: '/api/opencode/api/session/ses_1/command',
  respond: () => ({ status: 204 }),
}

const switchRoutes: FetchRoute[] = [
  { method: 'POST', path: '/api/opencode/api/session/ses_1/agent', respond: () => ({ status: 204 }) },
  { method: 'POST', path: '/api/opencode/api/session/ses_1/model', respond: () => ({ status: 204 }) },
]

function deferred() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((resolveResult) => {
    resolve = resolveResult
  })
  return { promise, resolve }
}

describe('useSessionGoal', () => {
  it('reads the goal from the local server', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute()],
    })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    const request = fetchFake.lastRequest('POST', goalReadPath)
    expect(request?.body).toEqual({ input: { sessionID: 'ses_1' } })
    expect(request?.searchParams.get('location[directory]')).toBe('/repo')
  })

  it('reads the goal from the current remote server and scopes its cache key', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      serverId: 'srv_remote',
      fetchRoutes: [
        goalRoute(),
        {
          method: 'POST',
          path: '/api/opencode/servers/srv_remote/api/rpc/opencode.goal/get',
          respond: () => ({ json: { output: goal } }),
        },
      ],
    })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    expect(queryClient.getQueryCache().find({ queryKey: ['session-goal', 'ses_1', 'srv_remote'] })).toBeDefined()
  })

  it('does not poll for goal updates', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute()],
    })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    vi.useFakeTimers()
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fetchFake.findRequests('POST', goalReadPath)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('applySessionGoalEvent', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates the cached goal without refetching', async () => {
    const { result, fetchFake, queryClient } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute()],
    })

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
    expect(fetchFake.findRequests('POST', goalReadPath)).toHaveLength(1)
  })

  it('ignores unrelated events and leaves the cached goal unchanged', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute()],
    })

    await waitFor(() => expect(result.current.data).toEqual(supportedGoal))

    let applied = true
    await act(async () => {
      applied = applySessionGoalEvent(queryClient, { type: 'session.idle', data: { sessionID: 'ses_1' } }, 'local')
    })

    expect(applied).toBe(false)
    expect(result.current.data).toEqual(supportedGoal)
  })

  it('writes the change under the event server scoped key', async () => {
    const { queryClient } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute()],
    })

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
    expect(queryClient.getQueryData(['session-goal', 'ses_1'])).toEqual(supportedGoal)
  })

  it('keeps the event goal when an in-flight read resolves afterwards', async () => {
    const pending = deferred()
    const { result, queryClient } = renderHookWithProviders(() => useSessionGoal('ses_1', '/repo'), {
      ...hookProviders,
      fetchRoutes: [goalRoute(() => pending.promise)],
    })

    await waitFor(() => expect(queryClient.getQueryState(['session-goal', 'ses_1'])?.fetchStatus).toBe('fetching'))

    act(() => {
      applySessionGoalEvent(
        queryClient,
        { type: 'rpc.opencode.goal.changed', data: { sessionID: 'ses_1', goal: updatedGoal } },
        'local',
      )
    })

    await waitFor(() => expect(result.current.data).toEqual({ supported: true, goal: updatedGoal }))

    await act(async () => {
      pending.resolve({ json: { output: goal } })
    })

    expect(result.current.data).toEqual({ supported: true, goal: updatedGoal })
  })
})

describe('useSessionGoalCommand', () => {
  it('runs the goal command on the session', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useSessionGoalCommand('/repo'), {
      ...hookProviders,
      fetchRoutes: [commandRoute, ...switchRoutes],
    })

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it' })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/command')?.body).toEqual({
      name: 'goal',
      text: 'Ship it',
    })
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/ses_1/agent')).toHaveLength(0)
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/ses_1/model')).toHaveLength(0)
  })

  it('syncs the session selection before running the goal command', async () => {
    const model = { providerID: 'anthropic', id: 'claude-sonnet-4' }
    const { result, queryClient, fetchFake } = renderHookWithProviders(() => useSessionGoalCommand('/repo'), {
      ...hookProviders,
      fetchRoutes: [commandRoute, ...switchRoutes],
    })
    queryClient.setQueryData(
      ['opencode', 'session', 'ses_1', '/repo'],
      makeSession({ id: 'ses_1', agent: 'build', location: { directory: '/repo' } }),
    )

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it', model, agent: 'plan' })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/agent')?.body).toEqual({ agent: 'plan' })
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/model')?.body).toEqual({
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    })

    const paths = fetchFake.requests.map((request) => request.path)
    expect(paths.indexOf('/api/opencode/api/session/ses_1/agent')).toBeLessThan(
      paths.indexOf('/api/opencode/api/session/ses_1/command'),
    )
  })

  it('reports the command failure message', async () => {
    const failingCommand: FetchRoute = {
      method: 'POST',
      path: '/api/opencode/api/session/ses_1/command',
      respond: () => ({ status: 400, json: { message: 'goal command failed' } }),
    }
    const { result } = renderHookWithProviders(() => useSessionGoalCommand('/repo'), {
      ...hookProviders,
      fetchRoutes: [failingCommand, ...switchRoutes],
    })

    await act(async () => {
      await result.current.mutateAsync({ sessionID: 'ses_1', text: 'Ship it' }).catch(() => undefined)
    })

    expect(await screen.findByText('goal command failed')).toBeInTheDocument()
  })
})
