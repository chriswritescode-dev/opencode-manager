import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useCommandHandler } from '../useCommandHandler'
import { showToast } from '@/lib/toast'
import { createCommandActionsMock } from '@/test/test-utils'
import { BUILTIN_COMMANDS, type CommandActions } from '@/lib/builtinCommands'

const builtinCommand = (name: string) => {
  const command = BUILTIN_COMMANDS.find((candidate) => candidate.name === name)
  if (!command) throw new Error(`Unknown built-in command: ${name}`)
  return command
}

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/api/opencode', async () => {
  const actual = await vi.importActual('@/api/opencode')
  return {
    ...actual,
    runCommand: mocks.runCommand,
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

  const renderHandler = (props: Record<string, unknown> = {}) => {
    const actions = (props.actions as CommandActions | undefined) ?? createCommandActionsMock()
    const rendered = renderHook(
      () => useCommandHandler({ sessionID: 'test-session-id', directory: '/test/dir', ...props, actions }),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    )
    return { ...rendered, actions }
  }

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
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
  })

  it('export dispatches the built-in action without running a server command', async () => {
    setSession(sessionInfo())

    const { result, actions } = renderHandler()

    const cleared = await result.current.executeCommand(builtinCommand('export'), { text: '' })

    expect(actions.exportSession).toHaveBeenCalledWith('')
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(cleared).toBe(true)
  })

  it('runs a server command that shares a built-in name through runCommand', async () => {
    setSession(sessionInfo())

    const { result, actions } = renderHandler()

    await result.current.executeCommand({ name: 'export' }, { text: '' })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session-id',
      name: 'export',
      text: '',
    }, 'local')
    expect(actions.exportSession).not.toHaveBeenCalled()
  })

  it('clear dispatches the new-session built-in action', async () => {
    setSession(sessionInfo())

    const { result, actions } = renderHandler()

    await result.current.executeCommand(builtinCommand('clear'), { text: '' })

    expect(actions.newSession).toHaveBeenCalled()
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('undo dispatches the built-in action and keeps the prompt', async () => {
    setSession(sessionInfo())

    const { result, actions } = renderHandler()

    const cleared = await result.current.executeCommand(builtinCommand('undo'), { text: '' })

    expect(actions.undo).toHaveBeenCalled()
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(cleared).toBe(false)
  })

  it('shows an error toast and keeps the prompt when a built-in action throws', async () => {
    setSession(sessionInfo())

    const actions = {
      ...createCommandActionsMock(),
      exportSession: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const { result } = renderHandler({ actions })

    const cleared = await result.current.executeCommand(builtinCommand('export'), { text: '' })

    expect(cleared).toBe(false)
    expect(showToast.error).toHaveBeenCalledWith('Command failed: boom')
  })

  it('review command runs the V2 command without injecting an agent attachment', async () => {
    setSession(sessionInfo({ agent: 'test-agent' }))

    const { result } = renderHandler({ currentAgent: 'test-agent' })

    await result.current.executeCommand({ name: 'review' }, { text: '' })

    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session-id',
      name: 'review',
      text: '',
    }, 'local')
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
    }, 'local')
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
    }, 'local')
    expect(mocks.switchSessionAgent).toHaveBeenCalledWith('test-session-id', 'plan', 'local')
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
})
