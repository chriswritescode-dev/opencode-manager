import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'
import { createCommandActionsMock } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  sendPrompt: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
  runCommand: vi.fn(),
  agents: [] as Array<{ name: string; description?: string }>,
  skills: [] as Array<{ id: string; name: string; description?: string }>,
  useSTT: vi.fn(),
  useMobile: vi.fn(),
  useCommands: vi.fn(),
  useFileSearch: vi.fn(),
  useModelSelection: vi.fn(),
  useVariants: vi.fn(),
  useSessionAgent: vi.fn(),
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
  useSendErrorStore: vi.fn(),
}))

const suggestionProps = vi.hoisted(() => ({ isOpen: false, selectedIndex: 0 }))

vi.mock('@/api/opencode', async () => {
  const actual = await vi.importActual('@/api/opencode')
  return {
    ...actual,
    sendPrompt: mocks.sendPrompt,
    runCommand: mocks.runCommand,
    switchSessionModel: mocks.switchSessionModel,
    switchSessionAgent: mocks.switchSessionAgent,
  }
})

vi.mock('@/hooks/useOpenCode', async () => {
  const actual = await vi.importActual('@/hooks/useOpenCode')
  return {
    ...actual,
    useAgents: () => ({ data: mocks.agents }),
    useSkills: () => ({ data: mocks.skills }),
  }
})

vi.mock('@/hooks/useSTT', () => ({ useSTT: mocks.useSTT }))
vi.mock('@/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))
vi.mock('@/hooks/useCommands', () => ({ useCommands: mocks.useCommands }))
vi.mock('@/hooks/useFileSearch', () => ({ useFileSearch: mocks.useFileSearch }))
vi.mock('@/hooks/useModelSelection', () => ({ useModelSelection: mocks.useModelSelection }))
vi.mock('@/hooks/useVariants', () => ({ useVariants: mocks.useVariants }))
vi.mock('@/hooks/useSessionAgent', () => ({ useSessionAgent: mocks.useSessionAgent }))
vi.mock('@/stores/userBashStore', () => ({ useUserBash: mocks.useUserBash }))
vi.mock('@/stores/sessionAgentStore', () => ({ useSessionAgentStore: mocks.useSessionAgentStore }))
vi.mock('@/stores/sendErrorStore', () => ({
  useSendErrorStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ errors: {} }),
    { getState: () => ({ clearError: vi.fn(), setError: vi.fn() }) },
  ),
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({
    hasForSession: vi.fn().mockReturnValue(false),
    setShowDialog: vi.fn(),
  }),
}))

vi.mock('@/components/agent/AgentQuickSelect', () => ({
  AgentQuickSelect: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/model/ModelQuickSelect', () => ({
  ModelQuickSelect: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/session/PermissionModeToggle', () => ({
  PermissionModeToggle: () => null,
}))

vi.mock('@/hooks/useSessionGoals', () => ({
  useSessionGoal: () => ({ data: undefined }),
  useStartSessionGoal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useSessionPermissionMode', () => ({
  useSessionPermissionMode: () => ({ data: undefined }),
}))

vi.mock('@/components/ui/session-status-indicator', () => ({
  SessionStatusIndicator: () => <div>SessionStatus</div>,
}))

vi.mock('./PromptSuggestions', () => ({
  PromptSuggestions: (props: { isOpen: boolean; selectedIndex: number }) => {
    if (props.isOpen) {
      suggestionProps.isOpen = true
      suggestionProps.selectedIndex = props.selectedIndex
    }
    return null
  },
}))

vi.mock('./ComposerToolsMenu', () => ({
  ComposerToolsMenu: () => null,
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

describe('PromptInput agent mention submission', () => {
  const defaultProps = {
    directory: '/test',
    sessionID: 'test-session',
    showScrollButton: false,
    isSessionActive: false,
    isStreamingResponse: false,
    onScrollToBottom: vi.fn(),
    commandActions: createCommandActionsMock(),
    onPromptChange: vi.fn(),
  }

  const renderComponent = (overrides: Partial<typeof defaultProps> = {}) => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'session', 'test-session', '/test'], sessionInfo())
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} {...overrides} />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendPrompt.mockResolvedValue({
      id: 'inbox_1',
      sessionID: 'test-session',
      time: { created: 1000 },
      type: 'user',
      payload: { text: '' },
      delivery: 'queue',
    })
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.agents = [{ name: 'reviewer', description: 'Reviewer' }]
    mocks.skills = [{ id: 'pr-review', name: 'PR Review', description: 'Review a PR' }]
    mocks.useMobile.mockReturnValue(false)
    mocks.useSTT.mockReturnValue({
      isRecording: false,
      isProcessing: false,
      isSupported: false,
      isEnabled: false,
      interimTranscript: '',
      transcript: '',
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      abortRecording: vi.fn(),
      reset: vi.fn(),
      clear: vi.fn(),
    })
    mocks.useCommands.mockReturnValue({ searchCommands: () => [], findCommand: () => undefined, recentNames: [] })
    mocks.useFileSearch.mockReturnValue({ files: [] })
    mocks.useModelSelection.mockReturnValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      modelString: 'anthropic/claude-sonnet-4',
      setModel: vi.fn(),
      setActiveAgent: vi.fn(),
      recentModels: [],
      favoriteModels: [],
      toggleFavorite: vi.fn(),
      isModelReady: true,
    })
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: vi.fn() })
    mocks.useSessionAgent.mockReturnValue({ agent: 'build' })
    mocks.useUserBash.mockImplementation((selector: (state: unknown) => unknown) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ setAgent: vi.fn() }))
    suggestionProps.isOpen = false
    suggestionProps.selectedIndex = 0
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
  })

  it('sends an @agent mention as an attachment without switching the session agent', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'ask @reviewer' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())

    expect(mocks.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'test-session',
      text: 'ask @reviewer',
      agents: [{ name: 'reviewer', mention: { start: 4, end: 13, text: '@reviewer' } }],
    }))
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
  })

  it('queues an @agent mention as an attachment without switching the session agent', async () => {
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'ask @reviewer' } })
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())

    expect(mocks.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'test-session',
      text: 'ask @reviewer',
      agents: [{ name: 'reviewer', mention: { start: 4, end: 13, text: '@reviewer' } }],
      delivery: 'queue',
    }))
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
  })

  it('sends an @skill mention as a skill attachment', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'use @pr-review and @pr-review' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())

    expect(mocks.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      text: 'use @pr-review and @pr-review',
      agents: [],
      skills: [{ id: 'pr-review', mention: { start: 4, end: 14, text: '@pr-review' } }],
    }))
  })

  it('sends plain text without inferring an agent attachment or switching', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'plain text' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())

    expect(mocks.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'test-session',
      text: 'plain text',
      agents: [],
    }))
    expect(mocks.switchSessionAgent).not.toHaveBeenCalled()
    expect(mocks.switchSessionModel).not.toHaveBeenCalled()
  })

  it('moves the mention selection in the visual direction of the arrow on mobile', async () => {
    mocks.useMobile.mockReturnValue(true)
    mocks.agents = [
      { name: 'alpha', description: 'Alpha agent' },
      { name: 'beta', description: 'Beta agent' },
    ]
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } })

    await waitFor(() => expect(suggestionProps.isOpen).toBe(true))
    expect(suggestionProps.selectedIndex).toBe(0)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    await waitFor(() => expect(suggestionProps.selectedIndex).toBe(1))

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(suggestionProps.selectedIndex).toBe(0))
  })

  it('keeps the desktop arrow direction unchanged', async () => {
    mocks.agents = [
      { name: 'alpha', description: 'Alpha agent' },
      { name: 'beta', description: 'Beta agent' },
    ]
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } })

    await waitFor(() => expect(suggestionProps.isOpen).toBe(true))
    expect(suggestionProps.selectedIndex).toBe(0)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(suggestionProps.selectedIndex).toBe(0)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(suggestionProps.selectedIndex).toBe(1))
  })
})
