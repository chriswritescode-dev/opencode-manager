import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionAgent, resolveDefaultSessionAgent } from './useSessionAgent'
import { useSession, useAgents } from './useOpenCode'
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
  useSession: vi.fn(),
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
  it('returns first visible primary/all agent when agents are loaded', () => {
    const agents = [
      { id: 'assistant', name: 'assistant', mode: 'primary' },
      { id: 'code', name: 'code', mode: 'all' },
    ]
    expect(resolveDefaultSessionAgent(agents, true)).toBe('assistant')
  })

  it('ignores hidden agents as fallback candidates', () => {
    const agents = [
      { id: 'hidden-agent', name: 'hidden-agent', mode: 'primary', hidden: true },
      { id: 'build', name: 'build', mode: 'primary' },
    ]
    expect(resolveDefaultSessionAgent(agents, true)).toBe('build')
  })

  it('ignores agents that are not primary or all mode', () => {
    const agents = [
      { id: 'sub-agent', name: 'sub-agent', mode: 'secondary' },
      { id: 'build', name: 'build', mode: 'primary' },
    ]
    expect(resolveDefaultSessionAgent(agents, true)).toBe('build')
  })

  it('falls back to build when no primary agent is available', () => {
    expect(resolveDefaultSessionAgent(undefined, false)).toBe('build')
    expect(resolveDefaultSessionAgent([], true)).toBe('build')
  })

  it('returns the first visible primary agent when agents load', () => {
    const agents = [{ id: 'code', name: 'code', mode: 'primary' }]
    expect(resolveDefaultSessionAgent(agents, true)).toBe('code')
  })

  it('returns assistant when assistant is the first visible primary agent', () => {
    const agents = [{ id: 'assistant', name: 'assistant', mode: 'primary' }]
    expect(resolveDefaultSessionAgent(agents, true)).toBe('assistant')
  })
})

describe('useSessionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionAgentStore.setState({ agents: {} })
  })

  it('returns the first primary agent when the session has no agent yet', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'assistant', name: 'assistant', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })

  it('returns the session-derived agent and model when the session has them', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        id: 'session-1',
        agent: 'assistant',
        model: { providerID: 'provider', id: 'model', variant: 'variant-1' },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'assistant', name: 'assistant', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
      expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'model' })
      expect(result.current.variant).toBe('variant-1')
    })
  })

  it('keeps the session selection while the session refetches in the background', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        id: 'session-1',
        agent: 'assistant',
        model: { providerID: 'provider', id: 'session-model', variant: 'session-variant' },
      },
      isLoading: false,
      isFetching: true,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'assistant', name: 'assistant', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
      expect(result.current.model).toEqual({ providerID: 'provider', modelID: 'session-model' })
      expect(result.current.variant).toBe('session-variant')
    })
  })

  it('falls back to the stored session agent instead of the default while the session loads', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'assistant' } })
    vi.mocked(useSession).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
    } as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'assistant', name: 'assistant', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('assistant')
    })
  })

  it('does not persist default agent fallback to store', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [{ id: 'code', name: 'code', mode: 'primary' }],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      const storeState = useSessionAgentStore.getState()
      expect(storeState.agents['session-1']).toBeUndefined()
    })
  })

  it('ignores a stale stored agent when unavailable in loaded primary agents', async () => {
    useSessionAgentStore.setState({ agents: { 'session-1': 'build' } })
    vi.mocked(useSession).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'architect', name: 'architect', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })

  it('falls back to the default agent when the session agent is unavailable in loaded primary agents', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        id: 'session-1',
        agent: 'build',
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSession>)
    vi.mocked(useAgents).mockReturnValue({
      data: [
        { id: 'code', name: 'code', mode: 'primary' },
        { id: 'architect', name: 'architect', mode: 'primary' },
      ],
      isSuccess: true,
    } as ReturnType<typeof useAgents>)

    const { result } = renderHook(() =>
      useSessionAgent('session-1', '/assistant')
    )

    await waitFor(() => {
      expect(result.current.agent).toBe('code')
    })
  })
})
