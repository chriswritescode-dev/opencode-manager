import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput, type PromptInputHandle } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'
import { createCommandActionsMock, stubMatchMedia } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
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

vi.mock('@/api/opencode', async () => {
  const actual = await vi.importActual('@/api/opencode')
  return {
    ...actual,
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

const sessionInfo = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-session',
  projectID: 'proj_1',
  time: { created: 1000, updated: 1000 },
  location: { directory: '/test' },
  agent: 'build',
  model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
  ...overrides,
})

describe('PromptInput command submission', () => {
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

  const renderComponent = () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'session', 'test-session', '/test'], sessionInfo())
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} />
      </QueryClientProvider>
    )
  }

  const attachImage = async (container: HTMLElement) => {
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const image = new File(['img'], 'pic.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [image] } })
    await screen.findByText('pic.png')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.switchSessionModel.mockResolvedValue(undefined)
    mocks.switchSessionAgent.mockResolvedValue(undefined)
    mocks.agents = [{ id: 'reviewer', name: 'reviewer', description: 'Reviewer', mode: 'primary' }]
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
    mocks.useCommands.mockReturnValue({
      filterCommands: (query: string) => {
        if (query === 'review') return [{ name: 'review', description: 'Review' }]
        const builtin = BUILTIN_COMMANDS.find((command) => command.name === query)
        return builtin ? [builtin] : []
      },
    })
    mocks.useFileSearch.mockReturnValue({ files: [] })
    mocks.useModelSelection.mockReturnValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      modelString: 'anthropic/claude-sonnet-4',
      setModel: vi.fn(),
      setActiveModel: vi.fn(),
      recentModels: [],
      favoriteModels: [],
      toggleFavorite: vi.fn(),
      isModelStateLoading: false,
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

  it('focuses the prompt on open with a fine pointer', async () => {
    stubMatchMedia(true)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    expect(input).toHaveFocus()
  })

  it('does not focus the prompt on open on touch devices', async () => {
    stubMatchMedia(false)
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    expect(input).not.toHaveFocus()
  })

  it('does not take focus from an element that already has it', async () => {
    stubMatchMedia(true)
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()

    renderComponent()

    await screen.findByPlaceholderText('Send a message...')
    expect(other).toHaveFocus()
    other.remove()
  })

  it('sends parsed command attachments and offsets to runCommand without injecting the selected agent', async () => {
    const { container } = renderComponent()

    act(() => {
      useUIState.getState().selectPromptFile('src/App.tsx')
    })

    const input = await screen.findByPlaceholderText('Send a message...')
    await waitFor(() => expect(input).toHaveValue('@App.tsx '))

    await attachImage(container)

    fireEvent.change(input, { target: { value: '/review @App.tsx @reviewer' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalled())

    const call = mocks.runCommand.mock.calls[0][0] as {
      sessionID: string
      name: string
      text: string
      files: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
      agents: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
      skills: unknown[]
    }

    expect(call.sessionID).toBe('test-session')
    expect(call.name).toBe('review')
    expect(call.text).toBe('@App.tsx @reviewer')
    expect(call.files).toEqual(expect.arrayContaining([
      { uri: 'file:///test/src/App.tsx', name: 'App.tsx', mention: { start: 0, end: 8, text: '@App.tsx' } },
      expect.objectContaining({ name: 'pic.png', uri: expect.stringMatching(/^data:image\/png/) }),
    ]))
    expect(call.agents).toEqual([
      { name: 'reviewer', mention: { start: 9, end: 18, text: '@reviewer' } },
    ])
    expect(call.skills).toEqual([])
  })

  it('runs a command whose arguments span multiple lines', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/review first line\nsecond line' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalled())
    expect(mocks.runCommand.mock.calls[0][0]).toMatchObject({
      name: 'review',
      text: 'first line\nsecond line',
    })
  })

  it('submits on plain Enter when the prompt is a known command', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/btw first line\nsecond line' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(defaultProps.commandActions.askSideQuestion).toHaveBeenCalledWith('first line\nsecond line'))
  })

  it('does not submit a known command on Shift+Enter', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/btw hi' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(defaultProps.commandActions.askSideQuestion).not.toHaveBeenCalled()
    expect(input).toHaveValue('/btw hi')
  })

  it.each(['hello there', '/bt hi', '/unknown hi'])('does not submit %j on plain Enter', async (value) => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue(value)
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(defaultProps.commandActions.askSideQuestion).not.toHaveBeenCalled()
  })

  it('preserves the submitted command text when the command submission fails', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('command failed'))
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/review' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalled())
    expect(input).toHaveValue('/review')
  })

  it('switches to the next primary agent for /agent without invoking runCommand', async () => {
    mocks.agents = [
      { id: 'build', name: 'build', mode: 'primary' },
      { id: 'plan', name: 'plan', mode: 'primary' },
    ]
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/agent' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.setAgent).toHaveBeenCalledWith('test-session', 'plan'))
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('reports when /variants is used with a model that has no variants', async () => {
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: mocks.cycleVariant })
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/variants' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.showToast.info).toHaveBeenCalledWith('The selected model has no variants'))
    expect(mocks.cycleVariant).not.toHaveBeenCalled()
  })

  it('cycles variants for /variants when the model has them', async () => {
    mocks.useVariants.mockReturnValue({ hasVariants: true, currentVariant: 'high', cycleVariant: mocks.cycleVariant })
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/variants' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.cycleVariant).toHaveBeenCalled())
    expect(mocks.showToast.info).not.toHaveBeenCalled()
  })

  it('opens the model picker through the imperative handle while the session is active', () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'session', 'test-session', '/test'], sessionInfo())
    const ref = createRef<PromptInputHandle>()

    render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} ref={ref} isSessionActive />
      </QueryClientProvider>
    )

    expect(screen.getByTestId('model-quick-select')).toHaveAttribute('data-open', 'false')

    act(() => {
      ref.current?.openModelPicker()
    })

    expect(screen.getByTestId('model-quick-select')).toHaveAttribute('data-open', 'true')
  })

  it('keeps attachments and clears only the text when a built-in command is submitted', async () => {
    const { container } = renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    await attachImage(container)

    fireEvent.change(input, { target: { value: '/btw hi' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.showToast.info).toHaveBeenCalledWith('Built-in commands do not use attachments; they were kept'))
    expect(input).toHaveValue('')
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('clears the prompt for a built-in command without attachments', async () => {
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/btw hi' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(input).toHaveValue(''))
    expect(mocks.showToast.info).not.toHaveBeenCalled()
  })
})
