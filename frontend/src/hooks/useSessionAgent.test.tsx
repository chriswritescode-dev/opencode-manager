import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resolveDefaultSessionAgent, useSessionAgent } from './useSessionAgent'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { AgentInfo } from '@opencode-manager/shared/opencode'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const sessionKey = ['opencode', 'session', 'session-1', '/assistant'] as const

const primaryAgents = [
  { id: 'code', name: 'code', mode: 'primary', hidden: false },
  { id: 'assistant', name: 'assistant', mode: 'primary', hidden: false },
]

function agentRoute(agents: object[] = primaryAgents): FetchRoute {
  return {
    method: 'GET',
    path: '/api/opencode/api/agent',
    respond: () => ({ json: { data: agents } }),
  }
}

function sessionRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'GET', path: '/api/opencode/api/session/session-1', respond }
}

function renderSessionAgent(routes: FetchRoute[]) {
  return renderHookWithProviders(() => useSessionAgent('session-1', '/assistant'), {
    ...hookProviders,
    fetchRoutes: routes,
  })
}

function agent(id: string, mode: AgentInfo['mode'], hidden = false) {
  return { id, mode, hidden }
}

describe('resolveDefaultSessionAgent', () => {
  it.each([
    { agents: [agent('assistant', 'primary'), agent('code', 'all')], expected: 'assistant' },
    { agents: [agent('code', 'primary')], expected: 'code' },
    { agents: [agent('assistant', 'primary')], expected: 'assistant' },
  ])('returns the first visible primary or all agent ($expected)', ({ agents, expected }) => {
    expect(resolveDefaultSessionAgent(agents, true)).toBe(expected)
  })

  it('ignores hidden agents as fallback candidates', () => {
    expect(resolveDefaultSessionAgent([agent('hidden-agent', 'primary', true), agent('build', 'primary')], true)).toBe(
      'build',
    )
  })

  it('ignores agents that are not primary or all mode', () => {
    expect(resolveDefaultSessionAgent([agent('sub-agent', 'subagent'), agent('build', 'primary')], true)).toBe('build')
  })

  it('falls back to build when no primary agent is available', () => {
    expect(resolveDefaultSessionAgent(undefined, false)).toBe('build')
    expect(resolveDefaultSessionAgent([], true)).toBe('build')
  })
})

describe('useSessionAgent', () => {
  it('returns the first primary agent when the session has no agent yet', async () => {
    const { result } = renderSessionAgent([agentRoute(), sessionRoute(() => new Promise(() => {}))])

    await waitFor(() => expect(result.current.agent).toBe('code'))
  })

  it('returns the session-derived agent and model when the session has them', async () => {
    const { result } = renderSessionAgent([
      agentRoute(),
      sessionRoute(() => ({
        json: {
          data: makeSession({
            id: 'session-1',
            agent: 'assistant',
            model: { providerID: 'provider', id: 'model', variant: 'variant-1' },
          }),
        },
      })),
    ])

    await waitFor(() => expect(result.current.agent).toBe('assistant'))
    expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'model' })
    expect(result.current.variant).toBe('variant-1')
  })

  it('keeps the session selection while the session refetches in the background', async () => {
    let requests = 0
    const { result, queryClient } = renderSessionAgent([
      agentRoute(),
      sessionRoute(() => {
        requests += 1
        if (requests === 1) {
          return {
            json: {
              data: makeSession({
                id: 'session-1',
                agent: 'assistant',
                model: { providerID: 'provider', id: 'session-model', variant: 'session-variant' },
              }),
            },
          }
        }
        return new Promise(() => {})
      }),
    ])

    await waitFor(() => expect(result.current.agent).toBe('assistant'))

    act(() => {
      void queryClient.invalidateQueries({ queryKey: sessionKey })
    })

    await waitFor(() => expect(queryClient.getQueryState(sessionKey)?.fetchStatus).toBe('fetching'))
    expect(result.current.agent).toBe('assistant')
    expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'session-model' })
    expect(result.current.variant).toBe('session-variant')
  })

  it('falls back to the stored session agent instead of the default while the session loads', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'assistant' } })
    const { result } = renderSessionAgent([agentRoute(), sessionRoute(() => new Promise(() => {}))])

    await waitFor(() => expect(result.current.agent).toBe('assistant'))
  })

  it('does not persist the default agent fallback to the store', async () => {
    renderSessionAgent([
      agentRoute([{ id: 'code', name: 'code', mode: 'primary', hidden: false }]),
      sessionRoute(() => new Promise(() => {})),
    ])

    await waitFor(() => expect(useSessionAgentStore.getState().agents['session-1']).toBeUndefined())
  })

  it('ignores a stale stored agent when it is unavailable in loaded primary agents', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'build' } })
    const { result } = renderSessionAgent([
      agentRoute([
        { id: 'code', name: 'code', mode: 'primary', hidden: false },
        { id: 'architect', name: 'architect', mode: 'primary', hidden: false },
      ]),
      sessionRoute(() => new Promise(() => {})),
    ])

    await waitFor(() => expect(result.current.agent).toBe('code'))
  })

  it('falls back to the default agent when the session agent is unavailable in loaded primary agents', async () => {
    const { result } = renderSessionAgent([
      agentRoute([
        { id: 'code', name: 'code', mode: 'primary', hidden: false },
        { id: 'architect', name: 'architect', mode: 'primary', hidden: false },
      ]),
      sessionRoute(() => ({ json: { data: makeSession({ id: 'session-1', agent: 'build' }) } })),
    ])

    await waitFor(() => expect(result.current.agent).toBe('code'))
  })
})
