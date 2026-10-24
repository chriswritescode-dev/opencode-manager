import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { useSessionStatus } from '@/stores/sessionStatusStore'
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
  useContextUsage: vi.fn(),
  sessionData: undefined as { revert?: { messageID: string } } | undefined,
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
  useSendShell: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve()), isPending: false }),
  useAgents: () => ({ data: [] }),
  useSkills: () => ({ data: [] }),
  useSession: () => ({ data: mocks.sessionData }),
}))

vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ data: undefined }) }))
vi.mock('@/hooks/useContextUsage', () => ({ useContextUsage: mocks.useContextUsage }))

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
vi.mock('./ComposerToolsMenu', () => ({
  ComposerToolsMenu: () => <div data-testid="composer-tools-menu" />,
}))
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
  sessionID: 'test-session',
  isSessionActive: false,
  isStreamingResponse: false,
  onScrollToBottom: vi.fn(),
  commandActions: createCommandActionsMock(),
  onPromptChange: vi.fn(),
}

describe('PromptInput composer layout', () => {
  const renderComponent = (overrides: Partial<typeof defaultProps> = {}) => render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PromptInput {...defaultProps} {...overrides} />
    </QueryClientProvider>,
  )

  const promptInput = () => screen.getByPlaceholderText('Send a message...')
  const submitButton = () => document.querySelector('[data-submit-prompt]')
  const controlsRow = () => screen.getByTestId('composer-controls-row')
  const voiceMicButton = () => screen.queryByRole('button', { name: 'Start voice conversation' })
  const keyButtons = () => screen.queryAllByRole('toolbar', { name: 'Insert' })

  beforeEach(() => {
    vi.clearAllMocks()
    useComposerDraftStore.setState({ drafts: {} })
    mocks.useSendPrompt.mockResolvedValue({ id: 'inbox_1' })
    mocks.useVoiceConversation.mockReturnValue(createVoiceConversationControllerMock())
    mocks.hasPendingPermission.mockReturnValue(false)
    mocks.useMobile.mockReturnValue(false)
    mocks.useSTT.mockReturnValue({
      isRecording: false,
      isProcessing: false,
      isSupported: true,
      isEnabled: true,
      interimTranscript: '',
      transcript: '',
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      abortRecording: vi.fn(),
      reset: vi.fn(),
      clear: vi.fn(),
    })
    mocks.useCommands.mockReturnValue({ searchCommands: () => [], findCommand: vi.fn(), recentNames: [] })
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
    mocks.useContextUsage.mockReturnValue({ usage: null, isLoading: false })
    mocks.sessionData = undefined
  })

  it('anchors the activity bar in the gap above the controls row', () => {
    useSessionStatus.getState().setStatus('test-session', { type: 'busy' })

    renderComponent()

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    expect(controlsRow()).toContainElement(bar)
    expect(controlsRow().firstElementChild).toBe(bar)
    expect(bar).toHaveClass('absolute', 'bottom-full')
    expect(promptInput().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    act(() => {
      useSessionStatus.getState().clearStatus('test-session')
    })
  })

  describe('primary action placement', () => {
    it('omits the submit button while the prompt is empty', () => {
      renderComponent()

      expect(promptInput()).toBeInTheDocument()
      expect(submitButton()).toBeNull()
    })

    it('renders the submit button after the textarea in the same row', () => {
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      const textarea = promptInput()
      const button = submitButton() as HTMLElement

      expect(button).not.toBeNull()
      expect(button.parentElement).toBe(textarea.parentElement)
      expect(textarea.nextElementSibling).toBe(button)
      expect(button.parentElement?.contains(controlsRow())).toBe(false)
    })

    it('sends the typed prompt from the row button', async () => {
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'row send' } })
      fireEvent.click(screen.getByTitle('Send'))

      await waitFor(() => expect(promptInput()).toHaveValue(''))
      const [variables] = mocks.useSendPrompt.mock.calls[0] as [{ text: string }]
      expect(variables.text).toBe('row send')
    })

    it('queues from the row button while a response streams', () => {
      renderComponent({ isStreamingResponse: true })

      fireEvent.change(promptInput(), { target: { value: 'follow-up' } })

      expect(screen.getByTitle('Queue message')).toBeInTheDocument()
    })

    it('shows View for a pending permission even while the prompt is empty', () => {
      mocks.hasPendingPermission.mockReturnValue(true)
      renderComponent()

      const view = screen.getByTitle('View pending permission')
      expect(view).toHaveTextContent('View')
      expect(view).toHaveAttribute('data-submit-prompt')
      expect(view.parentElement).toBe(promptInput().parentElement)

      fireEvent.click(view)
      expect(mocks.setShowDialog).toHaveBeenCalledWith(true)
    })
  })

  describe('model visibility', () => {
    it('keeps the model selector visible on mobile while the session is active', () => {
      mocks.useMobile.mockReturnValue(true)
      renderComponent({ isSessionActive: true })

      expect(screen.getByTestId('model-quick-select')).toBeInTheDocument()
      expect(screen.getByText('test-model')).toBeInTheDocument()
    })

    it('keeps the model selector visible on desktop while the session is active', () => {
      renderComponent({ isSessionActive: true })

      expect(screen.getByTestId('model-quick-select')).toBeInTheDocument()
    })
  })

  describe('model pill context usage', () => {
    const setUsage = (usage: { totalTokens: number, usagePercentage: number | null, contextLimit: number | null }) => {
      mocks.useContextUsage.mockReturnValue({ usage, isLoading: false })
    }

    it('shows the percentage with its tone and the meter on the model pill', () => {
      setUsage({ totalTokens: 84000, usagePercentage: 42, contextLimit: 200000 })
      renderComponent()

      const pill = screen.getByRole('button', { name: /test-model, context 42% used/ })
      const usage = screen.getByTestId('model-pill-context-usage')

      expect(pill).toContainElement(usage)
      expect(usage).toHaveTextContent('42%')
      expect(usage).toHaveClass('text-success')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '42%' })
    })

    it('tints the warning tone from 50 percent', () => {
      setUsage({ totalTokens: 120000, usagePercentage: 50, contextLimit: 240000 })
      renderComponent()

      expect(screen.getByTestId('model-pill-context-usage')).toHaveClass('text-warning')
    })

    it('tints the destructive tone from 80 percent', () => {
      setUsage({ totalTokens: 176000, usagePercentage: 88, contextLimit: 200000 })
      renderComponent()

      expect(screen.getByTestId('model-pill-context-usage')).toHaveClass('text-destructive')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '88%' })
    })

    it('caps the meter at full width when usage exceeds the context window', () => {
      setUsage({ totalTokens: 260000, usagePercentage: 130, contextLimit: 200000 })
      renderComponent()

      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '100%' })
    })

    it('falls back to a compact token count without a known context limit', () => {
      setUsage({ totalTokens: 12400, usagePercentage: null, contextLimit: null })
      renderComponent()

      expect(screen.getByRole('button', { name: /test-model, context 12k tokens used/ })).toBeInTheDocument()
      expect(screen.getByTestId('model-pill-context-usage')).toHaveTextContent('12k')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '0%' })
    })

    it('hides the usage without context data', () => {
      renderComponent()

      expect(screen.getByRole('button', { name: 'test-model' })).toBeInTheDocument()
      expect(screen.queryByTestId('model-pill-context-usage')).not.toBeInTheDocument()
      expect(screen.queryByTestId('context-usage-meter')).not.toBeInTheDocument()
    })

    it('measures usage up to the staged revert boundary', () => {
      mocks.sessionData = { revert: { messageID: 'msg_2' } }
      renderComponent()

      expect(mocks.useContextUsage).toHaveBeenCalledWith('test-session', '/test', 'msg_2')
    })
  })

  describe('mobile key bar', () => {
    beforeEach(() => {
      mocks.useMobile.mockReturnValue(true)
    })

    it('replaces the agent and model selectors with keys in the controls row while focused', () => {
      renderComponent()

      expect(keyButtons()).toHaveLength(0)
      expect(screen.getByTestId('agent-quick-select')).toBeInTheDocument()
      expect(screen.getByTestId('model-quick-select')).toBeInTheDocument()

      fireEvent.focus(promptInput())

      expect(keyButtons()).toHaveLength(1)
      expect(controlsRow().firstElementChild).toContainElement(keyButtons()[0])
      expect(screen.getByRole('button', { name: 'cmd /' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'mention @' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'bash !' })).toBeInTheDocument()
      expect(screen.queryByTestId('agent-quick-select')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-quick-select')).not.toBeInTheDocument()
    })

    it('restores the agent and model selectors after the prompt blurs', async () => {
      renderComponent()

      fireEvent.focus(promptInput())
      expect(screen.queryByTestId('model-quick-select')).not.toBeInTheDocument()

      fireEvent.blur(promptInput())

      await waitFor(() => {
        expect(screen.queryByRole('toolbar', { name: 'Insert' })).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('agent-quick-select')).toBeInTheDocument()
      expect(screen.getByTestId('model-quick-select')).toBeInTheDocument()
    })

    it('keeps the composer tools button at the bottom of the transcript', () => {
      renderComponent()

      expect(screen.getByTestId('composer-tools-menu')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument()
    })

    it('keeps the composer tools button while the prompt has text', () => {
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      expect(screen.getByTestId('composer-tools-menu')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument()
    })

    it('keeps the voice button and composer tools on the right side of the controls row', () => {
      renderComponent()

      fireEvent.focus(promptInput())

      const actions = controlsRow().lastElementChild as HTMLElement
      expect(actions).toContainElement(voiceMicButton() as HTMLElement)
      expect(actions).toContainElement(screen.getByTestId('composer-tools-menu'))
    })
  })

  describe('mobile voice button', () => {
    beforeEach(() => {
      mocks.useMobile.mockReturnValue(true)
    })

    it('renders the mobile mic alongside Send when the prompt has content', () => {
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      expect(submitButton()).not.toBeNull()
      expect(voiceMicButton()).not.toBeNull()
      expect(controlsRow().lastElementChild).toContainElement(voiceMicButton() as HTMLElement)
    })

    it('hides the mic while a permission is pending', () => {
      mocks.hasPendingPermission.mockReturnValue(true)
      renderComponent()

      expect(voiceMicButton()).toBeNull()
      expect(screen.getByTitle('View pending permission')).toBeInTheDocument()
    })
  })

  describe('control sizing', () => {
    it('keeps the mic at 44px before and after the prompt gains focus on mobile', () => {
      mocks.useMobile.mockReturnValue(true)
      renderComponent()

      const micBeforeFocus = voiceMicButton() as HTMLElement
      expect(micBeforeFocus).toHaveClass('min-h-11', 'min-w-11')
      expect(micBeforeFocus).not.toHaveClass('min-h-[44px]')

      fireEvent.focus(promptInput())

      const micAfterFocus = voiceMicButton() as HTMLElement
      expect(micAfterFocus).toHaveClass('min-h-11', 'min-w-11')
      expect(micAfterFocus).not.toHaveClass('min-h-[44px]')
    })

    it('keeps the key buttons at 36px after the prompt gains focus on mobile', () => {
      mocks.useMobile.mockReturnValue(true)
      renderComponent()

      fireEvent.focus(promptInput())

      const commandKey = screen.getByRole('button', { name: 'cmd /' })
      expect(commandKey).toHaveClass('min-h-9')
      expect(commandKey).not.toHaveClass('min-h-[44px]')
    })

    it('sizes the submit button at 36px on mobile', () => {
      mocks.useMobile.mockReturnValue(true)
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      const send = submitButton() as HTMLElement
      expect(send).toHaveClass('h-9')
      expect(send).not.toHaveClass('min-h-[44px]')
    })
  })
})
