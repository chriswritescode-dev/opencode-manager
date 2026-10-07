import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'
import { createCommandActionsMock, stubMatchMedia } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  sendPrompt: vi.fn(),
  sendShell: vi.fn(),
  interrupt: vi.fn(),
  startGoal: vi.fn(),
  useSessionGoal: vi.fn(),
  useSessionPermissionMode: vi.fn(),
  agents: [] as Array<{ id: string; name: string; description?: string; mode?: string; hidden?: boolean }>,
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
    useSendPrompt: () => ({ mutate: mocks.sendPrompt, isPending: false }),
    useSendShell: () => ({ mutate: mocks.sendShell, isPending: false }),
    useInterruptSession: () => ({ mutate: mocks.interrupt }),
    useAgents: () => ({ data: mocks.agents }),
  }
})

vi.mock('@/hooks/useSessionGoals', async () => {
  const { useState } = await import('react')
  return {
    useSessionGoal: mocks.useSessionGoal,
    useStartSessionGoal: () => {
      const [isPending, setIsPending] = useState(false)
      return {
        mutateAsync: async (variables: unknown) => {
          setIsPending(true)
          try {
            return await mocks.startGoal(variables)
          } finally {
            setIsPending(false)
          }
        },
        isPending,
      }
    },
  }
})

vi.mock('@/hooks/useSessionPermissionMode', () => ({
  useSessionPermissionMode: mocks.useSessionPermissionMode,
}))

vi.mock('@/hooks/useSTT', () => ({ useSTT: mocks.useSTT }))
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

vi.mock('@/components/ui/session-status-indicator', () => ({
  SessionStatusIndicator: () => <div>SessionStatus</div>,
}))

vi.mock('@/components/command/CommandSuggestions', () => ({
  CommandSuggestions: () => <div>CommandSuggestions</div>,
}))

vi.mock('./MentionSuggestions', () => ({
  MentionSuggestions: () => <div>MentionSuggestions</div>,
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const GOAL_BUTTON = 'Goal mode: the next message becomes the objective'
const OPEN_GOAL_BUTTON = 'A goal is already active for this session'

describe('PromptInput goal mode', () => {
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
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} {...overrides} />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSessionGoal.mockReturnValue({ data: null })
    mocks.useSessionPermissionMode.mockReturnValue({ data: undefined })
    mocks.startGoal.mockResolvedValue({ id: 1 })
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
    mocks.useCommands.mockReturnValue({ filterCommands: () => [] })
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
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: mocks.cycleVariant })
    mocks.useSessionAgent.mockReturnValue({ agent: 'build' })
    mocks.useUserBash.mockImplementation((selector: (state: unknown) => unknown) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ setAgent: mocks.setAgent }))
    mocks.useSendErrorStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ errors: {} }))
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('starts a goal with the message objective before sending it', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.startGoal).toHaveBeenCalledWith({
      sessionId: 'test-session',
      directory: '/test',
      objective: 'Ship the feature',
    }))
    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())
    expect(mocks.startGoal.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendPrompt.mock.invocationCallOrder[0])
  })

  it('does not send the message when starting the goal is rejected', async () => {
    stubMatchMedia(true)
    mocks.startGoal.mockRejectedValue(new Error('This session already has an open goal'))
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.startGoal).toHaveBeenCalled())
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
  })

  it('does not start a goal when the mode was not armed', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Just a message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())
    expect(mocks.startGoal).not.toHaveBeenCalled()
  })

  it('starts an armed goal before queueing when the session is busy', async () => {
    stubMatchMedia(true)
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.startGoal).toHaveBeenCalledWith({
      sessionId: 'test-session',
      directory: '/test',
      objective: 'Ship the feature',
    }))
    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: 'queue' }),
      expect.anything(),
    ))
    expect(mocks.startGoal.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendPrompt.mock.invocationCallOrder[0])
  })

  it('does not start the goal again while it is still starting', async () => {
    stubMatchMedia(true)
    let resolveGoal: (value: unknown) => void = () => {}
    mocks.startGoal.mockImplementation(
      () => new Promise((resolve) => {
        resolveGoal = resolve
      }),
    )
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.startGoal).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTitle('Queue message'))

    expect(mocks.startGoal).toHaveBeenCalledTimes(1)
    expect(mocks.sendPrompt).not.toHaveBeenCalled()

    await act(async () => {
      resolveGoal({ id: 1 })
    })
  })

  it('does not start an armed goal for a slash command', async () => {
    stubMatchMedia(true)
    mocks.useCommands.mockReturnValue({ filterCommands: () => [{ name: 'review' }] })
    renderComponent({ isStreamingResponse: true })

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/review the diff' } })
    fireEvent.click(screen.getByRole('button', { name: GOAL_BUTTON }))
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(mocks.sendPrompt).toHaveBeenCalled())
    expect(mocks.startGoal).not.toHaveBeenCalled()
  })

  it('disables goal mode while a goal is already active', async () => {
    stubMatchMedia(true)
    mocks.useSessionGoal.mockReturnValue({ data: { status: 'active' } })
    renderComponent()

    const button = await screen.findByRole('button', { name: OPEN_GOAL_BUTTON })
    expect(button).toBeDisabled()
  })

  it('disables goal mode with a reason for scheduled-run sessions', async () => {
    stubMatchMedia(true)
    mocks.useSessionPermissionMode.mockReturnValue({
      data: { sessionId: 'test-session', rootSessionId: 'test-session', mode: 'ask', lockedReason: 'schedule' },
    })
    renderComponent()

    const button = await screen.findByRole('button', { name: 'Scheduled runs cannot run goals' })
    expect(button).toBeDisabled()
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

  it('starts a goal armed from the mobile composer options menu', async () => {
    stubMatchMedia(true)
    mocks.useMobile.mockReturnValue(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'Ship the feature' } })
    fireEvent.click(screen.getByTestId('composer-tools-menu'))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.startGoal).toHaveBeenCalledWith({
      sessionId: 'test-session',
      directory: '/test',
      objective: 'Ship the feature',
    }))
  })

  it('passes the goal lock reason to the mobile composer options menu', async () => {
    stubMatchMedia(true)
    mocks.useMobile.mockReturnValue(true)
    mocks.useSessionGoal.mockReturnValue({ data: { status: 'active' } })
    renderComponent()

    const menu = await screen.findByTestId('composer-tools-menu')
    expect(menu).toHaveAttribute('title', OPEN_GOAL_BUTTON)
    expect(menu).toBeDisabled()
  })

  it('disables goal mode with a reason for child sessions', async () => {
    stubMatchMedia(true)
    mocks.useSessionPermissionMode.mockReturnValue({
      data: { sessionId: 'test-session', rootSessionId: 'test-session', mode: 'ask', lockedReason: 'child' },
    })
    renderComponent()

    const button = await screen.findByRole('button', { name: 'Goals can only be started on top-level sessions' })
    expect(button).toBeDisabled()
  })
})
