import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { createCommandActionsMock, stubMatchMedia, createVoiceConversationControllerMock } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  sendPrompt: vi.fn(),
  sendShell: vi.fn(),
  interrupt: vi.fn(),
  runCommand: vi.fn(),
  syncSelection: vi.fn(),
  getSessionGoal: vi.fn(),
  useSessionGoal: vi.fn(),
  useSessionPermissionMode: vi.fn(),
  agents: [] as Array<{ id: string; name: string; description?: string; mode?: string; hidden?: boolean }>,
  skills: [] as Array<{ id: string; name: string; description?: string }>,
  setAgent: vi.fn(),
  cycleVariant: vi.fn(),
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
  useSTT: vi.fn(),
  useVoiceConversation: vi.fn(),
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

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSendPrompt: () => ({ mutate: mocks.sendPrompt, mutateAsync: mocks.sendPrompt, isPending: false }),
    useSendShell: () => ({ mutate: mocks.sendShell, mutateAsync: mocks.sendShell, isPending: false }),
    useInterruptSession: () => ({ mutate: mocks.interrupt }),
    useAgents: () => ({ data: mocks.agents }),
    useSkills: () => ({ data: mocks.skills }),
    useSession: () => ({ data: undefined }),
    useSyncSessionSelection: () => mocks.syncSelection,
  }
})

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    runCommand: mocks.runCommand,
    getSessionGoal: mocks.getSessionGoal,
  }
})

vi.mock('@/hooks/useSessionGoals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSessionGoals')>()
  return {
    ...actual,
    useSessionGoal: mocks.useSessionGoal,
  }
})

vi.mock('@/hooks/useSessionPermissionMode', () => ({
  useSessionPermissionMode: mocks.useSessionPermissionMode,
}))

vi.mock('@/hooks/useSTT', () => ({
  useSTT: mocks.useSTT,
  useSttAvailability: () => ({ isEnabled: true, isSupported: true }),
}))
vi.mock('@/hooks/useVoiceConversation', () => ({ useVoiceConversation: mocks.useVoiceConversation }))
vi.mock('@/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))
vi.mock('@/hooks/useCommands', () => ({ useCommands: mocks.useCommands }))
vi.mock('@/hooks/useFileSearch', () => ({ useFileSearch: mocks.useFileSearch }))
vi.mock('@/hooks/useModelSelection', () => ({ useModelSelection: mocks.useModelSelection }))
vi.mock('@/hooks/useVariants', () => ({ useVariants: mocks.useVariants }))
vi.mock('@/hooks/useSessionAgent', () => ({ useSessionAgent: mocks.useSessionAgent }))
vi.mock('@/stores/userBashStore', () => ({ useUserBash: mocks.useUserBash }))
vi.mock('@/stores/sessionAgentStore', () => ({ useSessionAgentStore: mocks.useSessionAgentStore }))
vi.mock('@/stores/sendErrorStore', () => ({ useSendErrorStore: mocks.useSendErrorStore }))
vi.mock('@/lib/toast', () => ({ showToast: mocks.showToast }))

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
  ModelQuickSelect: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => (
    <div data-testid="model-quick-select" data-open={open ? 'true' : 'false'}>{children}</div>
  ),
}))

vi.mock('@/components/session/PermissionModeToggle', () => ({
  PermissionModeToggle: () => <div data-testid="permission-mode-toggle" />,
}))

vi.mock('./ComposerToolsMenu', () => ({
  ComposerToolsMenu: ({ goalDisabled, goalLabel, onToggleGoal }: {
    goalDisabled: boolean
    goalLabel: string
    onToggleGoal: () => void
  }) => (
    <button type="button" data-testid="composer-tools-menu" title={goalLabel} disabled={goalDisabled} onClick={onToggleGoal}>
      Composer options
    </button>
  ),
}))

vi.mock('@/components/session/SessionSandboxMenu', () => ({
  SessionSandboxMenu: () => null,
}))

vi.mock('./PromptSuggestions', () => ({
  PromptSuggestions: () => null,
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const GOAL_BUTTON = 'Goal mode: the next message becomes the objective'
const OPEN_GOAL_BUTTON = 'A goal is already active for this session'
const UNSUPPORTED_GOAL_BUTTON = "This server's OpenCode has no goals"

const goalState = {
  id: 'goal_1',
  objective: 'Ship the feature',
  status: 'active',
  rounds: 1,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1,
}

describe('PromptInput goal mode', () => {
  const defaultProps = {
    directory: '/test',
    sessionID: 'test-session',
    isSessionActive: false,
    isStreamingResponse: false,
    onScrollToBottom: vi.fn(),
    commandActions: createCommandActionsMock(),
    onPromptChange: vi.fn(),
  }

  const renderComponent = (overrides: Partial<typeof defaultProps> = {}) => {
    const queryClient = createTestQueryClient()
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} {...overrides} />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useComposerDraftStore.setState({ drafts: {} })
    mocks.useVoiceConversation.mockReturnValue(createVoiceConversationControllerMock())
    mocks.useSessionGoal.mockReturnValue({ data: { supported: true, goal: null } })
    mocks.useSessionPermissionMode.mockReturnValue({ data: undefined })
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.syncSelection.mockResolvedValue(undefined)
    mocks.getSessionGoal.mockResolvedValue({ supported: true, goal: null })
    mocks.sendPrompt.mockResolvedValue({ id: 'inbox_1' })
    mocks.sendShell.mockResolvedValue({ id: 'shell_1' })
    mocks.agents = []
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
      clear: vi.fn(),
    })
    mocks.useCommands.mockReturnValue({ searchCommands: () => [], findCommand: () => undefined, recentNames: [] })
    mocks.useFileSearch.mockReturnValue({ files: [] })
    mocks.useModelSelection.mockReturnValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      modelRef: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      modelString: 'anthropic/claude-sonnet-4',
      setModel: vi.fn(),
      setActiveAgent: vi.fn(),
      recentModels: [],
      favoriteModels: [],
      toggleFavorite: vi.fn(),
      isModelReady: true,
    })
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: mocks.cycleVariant })
    mocks.useSessionAgent.mockReturnValue({ agent: 'build' })
    mocks.useUserBash.mockImplementation((selector: (state: unknown) => unknown) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ setAgent: mocks.setAgent }))
    mocks.useSendErrorStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ errors: {} }))
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('runs the goal command with the message objective instead of sending the prompt', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalledTimes(1))
    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session',
      name: 'goal',
      text: 'Ship the feature',
      files: [],
      agents: [],
      skills: [],
    }, 'local')
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
  })

  it('runs the goal command instead of queueing when the session is busy', async () => {
    stubMatchMedia(true)
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalledTimes(1))
    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session',
      name: 'goal',
      text: 'Ship the feature',
      files: [],
      agents: [],
      skills: [],
    }, 'local')
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
  })

  it('does not send the prompt when the goal command is rejected', async () => {
    stubMatchMedia(true)
    mocks.runCommand.mockRejectedValue(new Error('goal command failed'))
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalledTimes(1))
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
  })

  it('passes the selected model and agent to the goal selection sync', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.syncSelection).toHaveBeenCalledWith({
      sessionID: 'test-session',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      agent: 'build',
    }))
    expect(mocks.runCommand).toHaveBeenCalled()
  })

  it('keeps the image draft and warns when an armed goal has no objective', async () => {
    stubMatchMedia(true)
    const { container } = renderComponent()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['img'], 'pic.png', { type: 'image/png' })] } })
    await screen.findByText('pic.png')

    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.showToast.error).toHaveBeenCalledWith('Enter an objective for the goal'))
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('keeps a whitespace-only draft and warns when an armed goal has no objective', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(mocks.showToast.error).toHaveBeenCalledWith('Enter an objective for the goal'))
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
    expect(input).toHaveValue('   ')
  })

  it('sends the prompt without the goal command when the goal mode was not armed', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Just a message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('does not run the goal command again while it is still pending', async () => {
    stubMatchMedia(true)
    let resolveCommand: (value: unknown) => void = () => {}
    mocks.runCommand.mockImplementation(
      () => new Promise((resolve) => {
        resolveCommand = resolve
      }),
    )
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTitle('Queue message'))

    expect(mocks.runCommand).toHaveBeenCalledTimes(1)
    expect(mocks.sendPrompt).not.toHaveBeenCalled()

    await act(async () => {
      resolveCommand(undefined)
    })
  })

  it('sends an exact slash command without running the goal command', async () => {
    stubMatchMedia(true)
    mocks.useCommands.mockReturnValue({
      searchCommands: () => [],
      findCommand: (name: string) => (name === 'review' ? { name: 'review' } : undefined),
      recentNames: [],
    })
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/review the diff' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('disables goal mode when the server has no goal support', async () => {
    stubMatchMedia(true)
    mocks.useSessionGoal.mockReturnValue({ data: { supported: false } })
    renderComponent()

    const button = await screen.findByRole('button', { name: UNSUPPORTED_GOAL_BUTTON })
    expect(button).toBeDisabled()
  })

  it('disables goal mode while a goal is already active', async () => {
    stubMatchMedia(true)
    mocks.useSessionGoal.mockReturnValue({ data: { supported: true, goal: goalState } })
    renderComponent()

    const button = await screen.findByRole('button', { name: OPEN_GOAL_BUTTON })
    expect(button).toBeDisabled()
  })

  it('keeps goal mode enabled on child sessions', async () => {
    stubMatchMedia(true)
    mocks.useSessionPermissionMode.mockReturnValue({
      data: { sessionId: 'test-session', rootSessionId: 'test-session', mode: 'ask', lockedReason: 'child' },
    })
    renderComponent()

    const button = await screen.findByRole('button', { name: GOAL_BUTTON })
    expect(button).toBeEnabled()
  })

  it('keeps permission and goal toggles inline on desktop', async () => {
    stubMatchMedia(true)
    renderComponent()

    expect(await screen.findByRole('button', { name: GOAL_BUTTON })).toBeInTheDocument()
    expect(screen.getByTestId('permission-mode-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-tools-menu')).not.toBeInTheDocument()
  })

  it('moves permission and goal toggles into the composer options menu on mobile', async () => {
    stubMatchMedia(true)
    mocks.useMobile.mockReturnValue(true)
    renderComponent()

    const menu = await screen.findByTestId('composer-tools-menu')
    expect(menu).toHaveAttribute('title', GOAL_BUTTON)
    expect(screen.queryByRole('button', { name: GOAL_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByTestId('permission-mode-toggle')).not.toBeInTheDocument()
  })

  it('runs the goal command when armed from the mobile composer options menu', async () => {
    stubMatchMedia(true)
    mocks.useMobile.mockReturnValue(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByTestId('composer-tools-menu'))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalledTimes(1))
    expect(mocks.runCommand).toHaveBeenCalledWith({
      sessionID: 'test-session',
      name: 'goal',
      text: 'Ship the feature',
      files: [],
      agents: [],
      skills: [],
    }, 'local')
  })

  it('passes the open goal state to the mobile composer options menu', async () => {
    stubMatchMedia(true)
    mocks.useMobile.mockReturnValue(true)
    mocks.useSessionGoal.mockReturnValue({ data: { supported: true, goal: goalState } })
    renderComponent()

    const menu = await screen.findByTestId('composer-tools-menu')
    expect(menu).toHaveAttribute('title', OPEN_GOAL_BUTTON)
    expect(menu).toBeDisabled()
  })
})
