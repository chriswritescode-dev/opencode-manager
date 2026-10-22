import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { createCommandActionsMock } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useSTT: vi.fn(),
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
  hasPendingPermission: vi.fn(() => false),
  setShowDialog: vi.fn(),
}))

vi.mock('@/hooks/useSTT', () => ({ useSTT: mocks.useSTT }))
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
  useSendPrompt: () => ({ mutate: mocks.useSendPrompt, isPending: false }),
  useInterruptSession: () => ({ mutate: vi.fn() }),
  useSendShell: () => ({ mutate: vi.fn(), isPending: false }),
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
  showScrollButton: false,
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
  const mobileVoiceButton = () => document.querySelector('[data-voice-variant="mobile"]')
  const keyButtons = () => screen.queryAllByRole('toolbar', { name: 'Insert' })

  beforeEach(() => {
    vi.clearAllMocks()
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

    it('sends the typed prompt from the row button', () => {
      renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'row send' } })
      fireEvent.click(screen.getByTitle('Send'))

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

    it('swaps the composer tools button for a scroll-to-bottom arrow while scrolled up', () => {
      renderComponent({ showScrollButton: true })

      const actions = controlsRow().lastElementChild as HTMLElement
      expect(within(actions).getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument()
      expect(screen.queryByTestId('composer-tools-menu')).not.toBeInTheDocument()
      expect(within(controlsRow().firstElementChild as HTMLElement).getByTestId('agent-quick-select')).toBeInTheDocument()
      expect(within(controlsRow().firstElementChild as HTMLElement).getByTestId('model-quick-select')).toBeInTheDocument()
      expect(screen.queryByText('Latest')).not.toBeInTheDocument()
    })

    it('keeps the scroll-to-bottom arrow on the right while the prompt is focused', () => {
      renderComponent({ showScrollButton: true })

      fireEvent.focus(promptInput())

      const keys = screen.getByRole('toolbar', { name: 'Insert' })
      expect(within(keys).getByRole('button', { name: 'bash !' })).toBeInTheDocument()

      const actions = controlsRow().lastElementChild as HTMLElement
      expect(within(actions).getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument()
      expect(screen.queryByTestId('composer-tools-menu')).not.toBeInTheDocument()
    })

    it('keeps the scroll-to-bottom arrow while the prompt has text', () => {
      renderComponent({ showScrollButton: true })

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument()
    })

    it('scrolls to the bottom from the swapped arrow and keeps the composer tools box size', () => {
      const onScrollToBottom = vi.fn()
      renderComponent({ showScrollButton: true, onScrollToBottom })

      const arrow = screen.getByRole('button', { name: 'Scroll to bottom' })
      expect(arrow).toHaveClass('size-11', 'p-0')

      fireEvent.click(arrow)

      expect(onScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('keeps the composer tools button while at the bottom of the transcript', () => {
      renderComponent({ showScrollButton: false })

      expect(screen.getByTestId('composer-tools-menu')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument()
    })

    it('keeps the voice button and composer tools on the right side of the controls row', () => {
      renderComponent()

      fireEvent.focus(promptInput())

      const actions = controlsRow().lastElementChild as HTMLElement
      expect(actions).toContainElement(mobileVoiceButton() as HTMLElement)
      expect(actions).toContainElement(screen.getByTestId('composer-tools-menu'))
    })
  })

  describe('desktop scroll button visibility', () => {
    const desktopScrollButton = () => screen.getByTitle('Scroll to bottom')

    it('hides the desktop scroll arrow once the prompt has text', () => {
      renderComponent({ showScrollButton: true })

      fireEvent.change(promptInput(), { target: { value: 'hello' } })

      expect(desktopScrollButton()).toHaveClass('invisible')
    })

    it('shows the desktop scroll arrow while the prompt is empty', () => {
      renderComponent({ showScrollButton: true })

      expect(desktopScrollButton()).toHaveClass('visible')
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
      expect(mobileVoiceButton()).not.toBeNull()
      expect(controlsRow().lastElementChild).toContainElement(mobileVoiceButton() as HTMLElement)
    })

    it('hides the mic while a permission is pending', () => {
      mocks.hasPendingPermission.mockReturnValue(true)
      renderComponent()

      expect(mobileVoiceButton()).toBeNull()
      expect(screen.getByTitle('View pending permission')).toBeInTheDocument()
    })
  })

  describe('control sizing', () => {
    it('keeps the mic at 44px before and after the prompt gains focus on mobile', () => {
      mocks.useMobile.mockReturnValue(true)
      renderComponent()

      const micBeforeFocus = mobileVoiceButton() as HTMLElement
      expect(micBeforeFocus).toHaveClass('min-h-11', 'min-w-11')
      expect(micBeforeFocus).not.toHaveClass('min-h-[44px]')

      fireEvent.focus(promptInput())

      const micAfterFocus = mobileVoiceButton() as HTMLElement
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
