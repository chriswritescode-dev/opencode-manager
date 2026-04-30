import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionAgent, resolveDefaultSessionAgent } from './useSessionAgent'
import { useMessages, useConfig, useAgents } from './useOpenCode'
import { useSessionAgentStore } from '../stores/sessionAgentStore'

const sessionAgentStoreMock = vi.hoisted(() => {
  const state = {
    agents: {} as Record<string, string>,
    setAgent: (sessionID: string, agent: string) => {
      state.agents = { ...state.agents, [sessionID]: agent }
    },
    getAgent: (sessionID: string) => state.agents[sessionID] ?? null,
  }

  const store = Object.assign(
    vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
    {
      getState: () => state,
      setState: (nextState: Partial<typeof state>) => {
        Object.assign(state, nextState)
      },
    }
  )

  return { state, store }
})

vi.mock('./useOpenCode', () => ({
  useMessages: vi.fn(),
  useConfig: vi.fn(),
  useAgents: vi.fn(),
}))

vi.mock('@/stores/sessionAgentStore', () => ({
  useSessionAgentStore: sessionAgentStoreMock.store,
}))

beforeEach(() => {
  vi.clearAllMocks()
  sessionAgentStoreMock.store.setState({ agents: {} })
})

describe('resolveDefaultSessionAgent', () => {
  it('returns config.default_agent when present and agents not loaded', () => {
    const result = resolveDefaultSessionAgent('code', undefined, false)
    expect(result).toBe('code')
  })

  it('returns config.default_agent when present and agent is in visible primary agents', () => {
    const agents = [
      { name: 'code', mode: 'primary' },
      { name: 'build', mode: 'primary' },
    ]
    const result = resolveDefaultSessionAgent('code', agents, true)
    expect(result).toBe('code')
  })

  it('returns config.default_agent case-insensitively when in primary agents', () => {
    const agents = [{ name: 'Code', mode: 'primary' }]
    const result = resolveDefaultSessionAgent('code', agents, true)
    expect(result).toBe('code')
  })

  it('returns first visible primary/all agent when config default is absent', () => {
    const agents = [
      { name: 'assistant', mode: 'primary' },
      { name: 'code', mode: 'all' },
    ]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('assistant')
  })

  it('ignores hidden agents as fallback candidates', () => {
    const agents = [
      { name: 'hidden-agent', mode: 'primary', hidden: true },
      { name: 'build', mode: 'primary' },
    ]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('build')
  })

  it('ignores agents that are not primary or all mode', () => {
    const agents = [
      { name: 'sub-agent', mode: 'secondary' },
      { name: 'build', mode: 'primary' },
    ]
    const result = resolveDefaultSessionAgent(undefined, agents, true)
    expect(result).toBe('build')
  })

  it('falls back to build only when no config default and no primary agent available', () => {
    const result = resolveDefaultSessionAgent(undefined, undefined, false)
    expect(result).toBe('build')
  })

  it('falls back to build when config default is not in primary agents and agents loaded', () => {
    const agents = [{ name: 'build', mode: 'primary' }]
    const result = resolveDefaultSessionAgent('missing-agent', agents, true)
    expect(result).toBe('build')
  })
})

describe('useSessionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionAgentStore.setState({ agents: {} })
  })

  it('returns config default agent for empty loaded messages with stale store build', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessages>)
    vi.mocked(useConfig).mockReturnValue({
      data: { default_agent: 'code' },
    } as ReturnType<typeof useConfig>)
    vi.mocked(useAgents).mockReturnValue({
      data: [{ name: 'code', mode: 'primary' }],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })

  it('returns message-derived agent when latest user message has agent', async () => {
    const messagesData = [
      {
        info: {
          role: 'user',
          agent: 'assistant',
          model: { providerID: 'provider', modelID: 'model' },
          variant: 'variant-1',
        },
      },
    ]
    vi.mocked(useMessages).mockReturnValue({
      data: messagesData,
      isLoading: false,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useConfig).mockReturnValue({
      data: { default_agent: 'code' },
    } as ReturnType<typeof useConfig>)
    vi.mocked(useAgents).mockReturnValue({
      data: [{ name: 'code', mode: 'primary' }],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
      expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'model' })
      expect(result.current.variant).toBe('variant-1')
    })
  })

  it('does not restore model from cached messages while refetching', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [
        {
          info: {
            role: 'user',
            agent: 'assistant',
            model: { providerID: 'provider', modelID: 'stale-model' },
            variant: 'stale-variant',
          },
        },
      ],
      isLoading: false,
      isFetching: true,
    } as ReturnType<typeof useMessages>)
    vi.mocked(useConfig).mockReturnValue({
      data: { default_agent: 'code' },
    } as ReturnType<typeof useConfig>)
    vi.mocked(useAgents).mockReturnValue({
      data: [{ name: 'code', mode: 'primary' }],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
      expect(result.current.model).toBeUndefined()
      expect(result.current.variant).toBeUndefined()
    })
  })

  it('does not persist default agent fallback to store', async () => {
    vi.mocked(useMessages).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessages>)
    vi.mocked(useConfig).mockReturnValue({
      data: { default_agent: 'code' },
    } as ReturnType<typeof useConfig>)
    vi.mocked(useAgents).mockReturnValue({
      data: [{ name: 'code', mode: 'primary' }],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    renderHook(() =>
      useSessionAgent('http://localhost:5551', 'session-1', '/assistant')
    )

    await waitFor(() => {
      const storeState = useSessionAgentStore.getState()
      expect(storeState.agents['session-1']).toBeUndefined()
    })
  })
})
