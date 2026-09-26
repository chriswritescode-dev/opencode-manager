import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useCommandHandler } from '../useCommandHandler'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  compactSession: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/api/opencode', async () => {
  const actual = await vi.importActual('@/api/opencode')
  return {
    ...actual,
    runCommand: mocks.runCommand,
    compactSession: mocks.compactSession,
    switchSessionModel: mocks.switchSessionModel,
    switchSessionAgent: mocks.switchSessionAgent,
  }
})

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn((selector) => selector({ setStatus: mocks.setStatus })),
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const sessionInfo = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-session-id',
  projectID: 'proj_1',
  time: { created: 1000, updated: 1000 },
  location: { directory: '/test/dir' },
  agent: 'build',
  model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
  ...overrides,
})

describe('useCommandHandler', () => {
  let queryClient: QueryClient

  const renderHandler = (props: Record<string, unknown> = {}) =>
    renderHook(
      () => useCommandHandler({ sessionID: 'test-session-id', directory: '/test/dir', ...props }),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    )

  const setSession = (session: Record<string, unknown>) => {
    queryClient.setQueryData(
      ['opencode', 'session', 'test-session-id', '/test/dir'],
      session,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.compactSession.mockResolvedValue(undefined)
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
  })

  it('themes command runs the V2 command without injecting an agent attachment', async () => {
    setSession(sessionInfo({ agent: 'test-agent' }))

    const { result } = renderHandler({ currentAgent: 'test-agent' })
    const themesCommand = { name: 'themes' }

    await result.current.executeCommand(themesCommand, { text: '' })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session-id',
      name: 'themes',
      text: '',
    })
  })

  it('compact command compacts the session', async () => {
    setSession(sessionInfo())

    const { result } = renderHandler()
    const compactCommand = { name: 'compact' }

    await result.current.executeCommand(compactCommand, { text: '' })

    expect(mocks.compactSession).toHaveBeenCalledWith('test-session-id')
  })

  it('unknown command runs the V2 command with the parsed payload', async () => {
    setSession(sessionInfo())

    const { result } = renderHandler()
    const files = [{ uri: 'file:///test/dir/src/App.tsx', name: 'App.tsx', mention: { start: 0, end: 8, text: '@App.tsx' } }]
    const agents = [{ name: 'reviewer', mention: { start: 9, end: 18, text: '@reviewer' } }]
    const skills = [{ id: 'review' }]

    await result.current.executeCommand({ name: 'myskill' }, { text: '@App.tsx @reviewer', files, agents, skills })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session-id',
      name: 'myskill',
      text: '@App.tsx @reviewer',
      files,
      agents,
      skills,
    })
  })

  it('sessions command opens sessions dialog without running a command', async () => {
    const onShowSessionsDialog = vi.fn()
    const { result } = renderHandler({ onShowSessionsDialog })
    const sessionsCommand = { name: 'sessions' }

    await result.current.executeCommand(sessionsCommand, { text: '' })

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(onShowSessionsDialog).toHaveBeenCalled()
  })

  it('switches model and agent before running the command when the selection changed', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    const { result } = renderHandler({
      model: { providerID: 'openai', id: 'gpt-4', variant: 'v1' },
      currentAgent: 'plan',
    })

    await result.current.executeCommand({ name: 'myskill' }, { text: '' })

    expect(mocks.switchSessionModel).toHaveBeenCalledWith('test-session-id', {
      providerID: 'openai',
      id: 'gpt-4',
      variant: 'v1',
    })
    expect(mocks.switchSessionAgent).toHaveBeenCalledWith('test-session-id', 'plan')
    expect(mocks.switchSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runCommand.mock.invocationCallOrder[0],
    )
    expect(mocks.switchSessionAgent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runCommand.mock.invocationCallOrder[0],
    )
  })

  it('does not switch when the selection matches the session', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))

    const { result } = renderHandler({
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      currentAgent: 'build',
    })

    await result.current.executeCommand({ name: 'myskill' }, { text: '' })

    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
    expect(mocks.runCommand).toHaveBeenCalled()
  })

  it('stops before running the command when the selection switch fails', async () => {
    setSession(sessionInfo({ agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } }))
    mocks.switchSessionModel.mockRejectedValueOnce(new Error('switch failed'))

    const { result } = renderHandler({
      model: { providerID: 'openai', id: 'gpt-4' },
      currentAgent: 'build',
    })

    const cleared = await result.current.executeCommand({ name: 'myskill' }, { text: '' })

    expect(cleared).toBe(false)
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('undo invokes the revert handler instead of running a command', async () => {
    setSession(sessionInfo())
    const onUndo = vi.fn()

    const { result } = renderHandler({ onUndo })

    const cleared = await result.current.executeCommand({ name: 'undo' }, { text: '' })

    expect(onUndo).toHaveBeenCalled()
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(cleared).toBe(false)
  })

  it('redo invokes the revert handler instead of running a command', async () => {
    setSession(sessionInfo())
    const onRedo = vi.fn()

    const { result } = renderHandler({ onRedo })

    const cleared = await result.current.executeCommand({ name: 'redo' }, { text: '' })

    expect(onRedo).toHaveBeenCalled()
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(cleared).toBe(false)
  })
})
