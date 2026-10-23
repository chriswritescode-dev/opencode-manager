import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { createCommandActionsMock, createVoiceConversationControllerMock } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useSTT: vi.fn(),
  useVoiceConversation: vi.fn(),
  useMobile: vi.fn(),
  useCommands: vi.fn(),
  useCommandHandler: vi.fn(),
  useFileSearch: vi.fn(),
  useModelSelection: vi.fn(),
  useVariants: vi.fn(),
  useSessionAgent: vi.fn(),
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
  useSendErrorStore: vi.fn(),
  useHasBackgroundActivity: vi.fn(),
  useSendPrompt: vi.fn(),
  useSendShell: vi.fn(),
  hasPendingPermission: vi.fn(() => false),
  setShowDialog: vi.fn(),
}))

vi.mock('@/hooks/useSTT', () => ({
  useSTT: mocks.useSTT,
  useSttAvailability: () => ({ isEnabled: true, isSupported: true }),
}))
vi.mock('@/hooks/useVoiceConversation', () => ({ useVoiceConversation: mocks.useVoiceConversation }))
vi.mock('@/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))
vi.mock('@/hooks/useCommands', () => ({ useCommands: mocks.useCommands }))
vi.mock('@/hooks/useCommandHandler', () => ({ useCommandHandler: mocks.useCommandHandler }))
vi.mock('@/hooks/useFileSearch', () => ({ useFileSearch: mocks.useFileSearch }))
vi.mock('@/hooks/useModelSelection', () => ({ useModelSelection: mocks.useModelSelection }))
vi.mock('@/hooks/useVariants', () => ({ useVariants: mocks.useVariants }))
vi.mock('@/hooks/useSessionAgent', () => ({ useSessionAgent: mocks.useSessionAgent }))
vi.mock('@/stores/userBashStore', () => ({ useUserBash: mocks.useUserBash }))
vi.mock('@/stores/sessionAgentStore', () => ({ useSessionAgentStore: mocks.useSessionAgentStore }))
vi.mock('@/stores/sendErrorStore', () => ({ useSendErrorStore: mocks.useSendErrorStore }))
vi.mock('@/stores/sessionStatusStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/sessionStatusStore')>()
  return { ...actual, useHasBackgroundActivity: mocks.useHasBackgroundActivity }
})
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), promise: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSendPrompt: () => ({ mutate: mocks.useSendPrompt, mutateAsync: mocks.useSendPrompt, isPending: false }),
  useInterruptSession: () => ({ mutate: vi.fn() }),
  useSendShell: () => ({ mutate: mocks.useSendShell, mutateAsync: mocks.useSendShell, isPending: false }),
  useAgents: () => ({ data: [] }),
  useSkills: () => ({ data: [] }),
}))

vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ data: undefined }) }))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({
    hasForSession: mocks.hasPendingPermission,
    setShowDialog: mocks.setShowDialog,
  }),
}))

vi.mock('@/components/agent/AgentQuickSelect', () => ({
  AgentQuickSelect: () => <div data-testid="agent-quick-select" />,
}))

vi.mock('@/components/model/ModelQuickSelect', () => ({
  ModelQuickSelect: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="model-quick-select">{children}</div>
  ),
}))

vi.mock('@/components/session/PermissionModeToggle', () => ({ PermissionModeToggle: () => null }))
vi.mock('@/components/session/SessionSandboxMenu', () => ({ SessionSandboxMenu: () => null }))
vi.mock('./ComposerToolsMenu', () => ({ ComposerToolsMenu: () => null }))
vi.mock('./PromptSuggestions', () => ({ PromptSuggestions: () => null }))
vi.mock('@/hooks/useSessionGoals', () => ({
  useSessionGoal: () => ({ data: undefined }),
  useStartSessionGoal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useSessionPermissionMode', () => ({ useSessionPermissionMode: () => ({ data: undefined }) }))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

const defaultProps = {
  directory: '/test',
  sessionID: 'session-a',
  showScrollButton: false,
  isSessionActive: false,
  isStreamingResponse: false,
  onScrollToBottom: vi.fn(),
  commandActions: createCommandActionsMock(),
  onPromptChange: vi.fn(),
}

describe('PromptInput per-session composer draft', () => {
  const harness = (sessionID: string, overrides: Partial<typeof defaultProps> = {}) => (
    <QueryClientProvider client={createTestQueryClient()}>
      <PromptInput key={sessionID} {...defaultProps} {...overrides} sessionID={sessionID} />
    </QueryClientProvider>
  )

  const renderSession = (sessionID: string, overrides: Partial<typeof defaultProps> = {}) =>
    render(harness(sessionID, overrides))

  const promptInput = () => screen.getByPlaceholderText(/Send a message\.\.\.|Enter bash command\.\.\./)

  const attachImage = async (container: HTMLElement) => {
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['img'], 'pic.png', { type: 'image/png' })] } })
    await screen.findByText('pic.png')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useComposerDraftStore.setState({ drafts: {} })
    mocks.useSendPrompt.mockResolvedValue({ id: 'inbox_1' })
    mocks.useSendShell.mockResolvedValue({ id: 'shell_1' })
    mocks.useVoiceConversation.mockReturnValue(createVoiceConversationControllerMock())
    mocks.hasPendingPermission.mockReturnValue(false)
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
    mocks.useCommandHandler.mockReturnValue({ executeCommand: vi.fn() })
    mocks.useFileSearch.mockReturnValue({ files: [] })
    mocks.useModelSelection.mockReturnValue({
      model: null,
      modelString: 'test-model',
      setModel: vi.fn(),
      setActiveAgent: vi.fn(),
      recentModels: [],
      favoriteModels: [],
      toggleFavorite: vi.fn(),
      isModelReady: true,
    })
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: vi.fn() })
    mocks.useSessionAgent.mockReturnValue({ agent: 'default' })
    mocks.useUserBash.mockImplementation((selector: (state: unknown) => unknown) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ setAgent: vi.fn() }))
    mocks.useSendErrorStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ errors: {} }))
    mocks.useHasBackgroundActivity.mockReturnValue(false)
  })

  it('keeps the typed draft of each session', () => {
    const { rerender } = renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: 'draft for A' } })

    rerender(harness('session-b'))
    expect(promptInput()).toHaveValue('')

    fireEvent.change(promptInput(), { target: { value: 'draft for B' } })

    rerender(harness('session-a'))
    expect(promptInput()).toHaveValue('draft for A')

    rerender(harness('session-b'))
    expect(promptInput()).toHaveValue('draft for B')
  })

  it('keeps bash mode and attachments of each session', async () => {
    const { container, rerender } = renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: '!' } })
    await attachImage(container)
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')

    rerender(harness('session-b'))
    expect(promptInput()).toHaveValue('')
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('pic.png')).not.toBeInTheDocument()

    rerender(harness('session-a'))
    expect(promptInput()).toHaveValue('!')
    expect(screen.getByPlaceholderText('Enter bash command...')).toBeInTheDocument()
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('sends the restored draft to the session that owns it and clears only that draft', async () => {
    const { rerender } = renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: 'draft for A' } })

    rerender(harness('session-b'))
    fireEvent.change(promptInput(), { target: { value: 'draft for B' } })

    rerender(harness('session-a'))
    fireEvent.click(screen.getByTitle('Send'))

    expect(mocks.useSendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'session-a', text: 'draft for A' }),
    )
    await waitFor(() => expect(promptInput()).toHaveValue(''))

    rerender(harness('session-b'))
    expect(promptInput()).toHaveValue('draft for B')
  })

  it('clears a submitted draft after its session unmounted before the send resolved', async () => {
    let resolveSend: (value: { id: string }) => void = () => {}
    mocks.useSendPrompt.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve
    }))

    const { rerender } = renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: 'sent while leaving' } })
    fireEvent.click(screen.getByTitle('Send'))
    expect(useComposerDraftStore.getState().getDraft('session-a').prompt).toBe('sent while leaving')

    rerender(harness('session-b'))
    await act(async () => {
      resolveSend({ id: 'inbox_1' })
    })

    rerender(harness('session-a'))
    expect(promptInput()).toHaveValue('')
  })

  it('clears a submitted bash command after its session unmounted before the send resolved', async () => {
    let resolveShell: (value: { id: string }) => void = () => {}
    mocks.useSendShell.mockImplementation(() => new Promise((resolve) => {
      resolveShell = resolve
    }))

    const { rerender } = renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: '!' } })
    fireEvent.change(screen.getByPlaceholderText('Enter bash command...'), { target: { value: '!ls' } })
    fireEvent.click(screen.getByTitle('Send'))

    rerender(harness('session-b'))
    await act(async () => {
      resolveShell({ id: 'shell_1' })
    })

    rerender(harness('session-a'))
    expect(promptInput()).toHaveValue('')
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
  })

  it('keeps text typed after the submit when the send resolves', async () => {
    let resolveSend: (value: { id: string }) => void = () => {}
    mocks.useSendPrompt.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve
    }))

    renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: 'sent message' } })
    fireEvent.click(screen.getByTitle('Send'))
    fireEvent.change(promptInput(), { target: { value: 'sent message plus an edit' } })

    await act(async () => {
      resolveSend({ id: 'inbox_1' })
    })

    expect(promptInput()).toHaveValue('sent message plus an edit')
    expect(useComposerDraftStore.getState().getDraft('session-a').prompt).toBe('sent message plus an edit')
  })

  it('keeps the draft when Escape is pressed while the session is idle', () => {
    renderSession('session-a')

    fireEvent.change(promptInput(), { target: { value: 'an important draft' } })
    fireEvent.keyDown(promptInput(), { key: 'Escape' })

    expect(promptInput()).toHaveValue('an important draft')
  })

  it('reports suggestion list changes instead of clearing on Escape', async () => {
    const onSuggestionsOpenChange = vi.fn()
    mocks.useCommands.mockReturnValue({
      searchCommands: () => [{ item: { name: 'alpha', description: 'Alpha' }, ranges: [] }],
      findCommand: () => undefined,
      recentNames: [],
    })

    renderSession('session-a', { onSuggestionsOpenChange })
    expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(promptInput(), { target: { value: '/al', selectionStart: 3 } })

    await waitFor(() => expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(true))
    expect(promptInput()).toHaveValue('/al')

    fireEvent.keyDown(promptInput(), { key: 'Escape' })

    await waitFor(() => expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(false))
    expect(promptInput()).toHaveValue('/al')
  })

  it('labels the attachment remove button with the filename', async () => {
    const { container } = renderSession('session-a')

    await attachImage(container)

    expect(screen.getByRole('button', { name: 'Remove pic.png' })).toBeInTheDocument()
  })
})
