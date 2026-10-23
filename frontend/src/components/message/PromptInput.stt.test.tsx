import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import {
  SessionTranscriptContext,
  type SessionTranscriptSnapshot,
} from '@/contexts/session-transcript-context'
import {
  createCommandActionsMock,
  createVoiceConversationControllerMock,
} from '@/test/test-utils'
import type {
  UseVoiceConversationInput,
  VoiceConversationController,
} from '@/hooks/useVoiceConversation'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const mocks = vi.hoisted(() => ({
  useSttAvailability: vi.fn(),
  useVoiceConversation: vi.fn(),
  useMobile: vi.fn(),
  useSendPromptMutate: vi.fn(),
  useSendPromptMutateAsync: vi.fn(),
  sendPromptPending: vi.fn(() => false),
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
  useSendErrorStore: vi.fn(),
}))

vi.mock('@/hooks/useSTT', () => ({
  useSttAvailability: mocks.useSttAvailability,
}))

vi.mock('@/hooks/useVoiceConversation', () => ({
  useVoiceConversation: mocks.useVoiceConversation,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSendPrompt: () => ({
    mutate: mocks.useSendPromptMutate,
    mutateAsync: mocks.useSendPromptMutateAsync,
    isPending: mocks.sendPromptPending(),
  }),
  useInterruptSession: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useSendShell: () => ({ mutate: vi.fn(), isPending: false }),
  useAgents: () => ({ data: [] }),
  useSkills: () => ({ data: [] }),
}))

vi.mock('@/hooks/useCommands', () => ({
  useCommands: () => ({ searchCommands: () => [], findCommand: vi.fn(), recentNames: [] }),
}))

vi.mock('@/hooks/useCommandHandler', () => ({
  useCommandHandler: () => ({ executeCommand: vi.fn() }),
}))

vi.mock('@/hooks/useFileSearch', () => ({
  useFileSearch: () => ({ files: [] }),
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: () => ({
    model: null,
    modelString: 'test-model',
    setModel: vi.fn(),
    setActiveAgent: vi.fn(),
    recentModels: [],
    favoriteModels: [],
    toggleFavorite: vi.fn(),
    isModelReady: true,
  }),
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariants: () => ({ hasVariants: false, currentVariant: null, cycleVariant: vi.fn() }),
}))

vi.mock('@/hooks/useSessionAgent', () => ({
  useSessionAgent: () => ({ agent: 'default' }),
}))

vi.mock('@/stores/userBashStore', () => ({
  useUserBash: mocks.useUserBash,
}))

vi.mock('@/stores/sessionAgentStore', () => ({
  useSessionAgentStore: mocks.useSessionAgentStore,
}))

vi.mock('@/stores/sendErrorStore', () => ({
  useSendErrorStore: mocks.useSendErrorStore,
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

vi.mock('./ComposerToolsMenu', () => ({
  ComposerToolsMenu: () => null,
}))

vi.mock('@/components/session/SessionSandboxMenu', () => ({
  SessionSandboxMenu: () => null,
}))

vi.mock('@/hooks/useSessionGoals', () => ({
  useSessionGoal: () => ({ data: undefined }),
  useStartSessionGoal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useSessionPermissionMode', () => ({
  useSessionPermissionMode: () => ({ data: undefined }),
}))

vi.mock('./PromptSuggestions', () => ({
  PromptSuggestions: () => null,
}))

describe('PromptInput voice conversation', () => {
  const mockSetAgent = vi.fn()

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

  const createUserMessage = (id: string, text: string): SessionMessageInfo => ({
    id,
    type: 'user',
    text,
    time: { created: 1000 },
  } as SessionMessageInfo)

  const buildSnapshot = (overrides: Partial<SessionTranscriptSnapshot> = {}): SessionTranscriptSnapshot => ({
    messages: [],
    pending: [],
    status: 'idle',
    ...overrides,
  })

  const renderComponent = (
    overrides: Partial<typeof defaultProps> = {},
    snapshotOverrides: Partial<SessionTranscriptSnapshot> = {},
  ) => {
    const queryClient = createTestQueryClient()
    const tree = (
      nextOverrides: Partial<typeof defaultProps>,
      snapshot = buildSnapshot(snapshotOverrides),
    ) => (
      <QueryClientProvider client={queryClient}>
        <SessionTranscriptContext.Provider value={snapshot}>
          <PromptInput {...defaultProps} {...overrides} {...nextOverrides} />
        </SessionTranscriptContext.Provider>
      </QueryClientProvider>
    )
    const view = render(tree({}))
    return {
      ...view,
      rerenderWith: (nextOverrides: Partial<typeof defaultProps>) => {
        view.rerender(tree(nextOverrides, buildSnapshot(snapshotOverrides)))
      },
    }
  }

  const setVoiceController = (
    controller: Partial<VoiceConversationController> = {},
    capturedText = 'half a sentence',
  ) => {
    mocks.useVoiceConversation.mockImplementation((input: UseVoiceConversationInput) =>
      createVoiceConversationControllerMock({
        ...controller,
        editInTextBox: () => input.onEditInTextBox(capturedText),
      }),
    )
  }

  const voiceInput = (): UseVoiceConversationInput => {
    const call = mocks.useVoiceConversation.mock.calls.at(-1)
    if (!call) throw new Error('useVoiceConversation was not called')
    return call[0] as UseVoiceConversationInput
  }

  const promptInput = () => screen.getByPlaceholderText('Send a message...')
  const voiceMic = () => screen.queryByRole('button', { name: 'Start voice conversation' })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSendPromptMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.()
    })
    mocks.useSendPromptMutateAsync.mockResolvedValue({ id: 'inbox_1' })
    mocks.sendPromptPending.mockReturnValue(false)
    mocks.useMobile.mockReturnValue(true)
    mocks.useSttAvailability.mockReturnValue({ isEnabled: true, isSupported: true })
    setVoiceController()
    mocks.useUserBash.mockImplementation((selector) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector) => selector({ setAgent: mockSetAgent }))
    mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))
  })

  describe('microphone availability', () => {
    it('shows the microphone on mobile when speech-to-text is enabled and supported', () => {
      mocks.useMobile.mockReturnValue(true)

      renderComponent()

      expect(voiceMic()).toBeInTheDocument()
    })

    it('shows the microphone on desktop when speech-to-text is enabled and supported', () => {
      mocks.useMobile.mockReturnValue(false)

      renderComponent()

      expect(voiceMic()).toBeInTheDocument()
    })

    it('hides the microphone when speech-to-text is disabled', () => {
      mocks.useSttAvailability.mockReturnValue({ isEnabled: false, isSupported: true })

      renderComponent()

      expect(voiceMic()).toBeNull()
    })

    it('hides the microphone when the browser cannot capture speech', () => {
      mocks.useSttAvailability.mockReturnValue({ isEnabled: true, isSupported: false })

      renderComponent()

      expect(voiceMic()).toBeNull()
    })

    it('starts the conversation when the microphone is pressed', () => {
      const controller = createVoiceConversationControllerMock()
      mocks.useVoiceConversation.mockReturnValue(controller)

      renderComponent()
      fireEvent.click(voiceMic() as HTMLElement)

      expect(controller.start).toHaveBeenCalledTimes(1)
    })
  })

  it('passes the published transcript to the voice conversation', () => {
    const messages = [createUserMessage('msg_voice_1', 'hello there')]

    renderComponent({}, { messages, status: 'busy' })

    expect(mocks.useVoiceConversation).toHaveBeenCalledWith(
      expect.objectContaining({ messages, status: 'busy' }),
    )
  })

  describe('while a conversation is active', () => {
    it('replaces the composer with the conversation bar and keeps the draft after exit', () => {
      const onVoiceConversationActiveChange = vi.fn()
      const view = renderComponent({ onVoiceConversationActiveChange })

      fireEvent.change(promptInput(), { target: { value: 'keep this draft' } })

      setVoiceController({ isActive: true, phase: 'listening', label: 'Listening' })
      view.rerenderWith({})

      expect(screen.queryByPlaceholderText('Send a message...')).toBeNull()
      expect(screen.getByText('Listening')).toBeInTheDocument()
      expect(onVoiceConversationActiveChange).toHaveBeenLastCalledWith(true)

      setVoiceController()
      view.rerenderWith({})

      expect(promptInput()).toHaveValue('keep this draft')
      expect(onVoiceConversationActiveChange).toHaveBeenLastCalledWith(false)
    })

    it('moves the captured transcript into the text box', () => {
      setVoiceController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')

      const view = renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      setVoiceController()
      view.rerenderWith({})

      expect(promptInput()).toHaveValue('dictated words')
    })

    it('appends the captured transcript after an existing draft', () => {
      const view = renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'draft' } })

      setVoiceController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')
      view.rerenderWith({})
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      setVoiceController()
      view.rerenderWith({})

      expect(promptInput()).toHaveValue('draft dictated words')
    })

    it('focuses the text box with the cursor after the transcript once the conversation closes', async () => {
      const view = renderComponent({ onVoiceConversationActiveChange: vi.fn() })

      fireEvent.change(promptInput(), { target: { value: 'draft' } })

      setVoiceController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')
      view.rerenderWith({})
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      setVoiceController()
      view.rerenderWith({})

      await waitFor(() => {
        const input = promptInput() as HTMLTextAreaElement
        expect(input).toHaveFocus()
        expect(input.selectionStart).toBe('draft dictated words'.length)
        expect(input.selectionEnd).toBe('draft dictated words'.length)
      })
    })
  })

  describe('sending a voice turn', () => {
    it('queues the turn while the session is busy and leaves the draft untouched', async () => {
      const view = renderComponent()

      fireEvent.change(promptInput(), { target: { value: 'my draft' } })

      await voiceInput().sendTurn('add a retry', { busy: true })

      expect(mocks.useSendPromptMutateAsync).toHaveBeenCalledWith({
        sessionID: 'test-session',
        text: 'add a retry',
        model: undefined,
        agent: 'default',
        delivery: 'queue',
      })
      view.rerenderWith({})
      expect(promptInput()).toHaveValue('my draft')
      expect(mockSetAgent).toHaveBeenCalledWith('test-session', 'default')
    })

    it('sends the turn without a delivery while the session is idle', async () => {
      renderComponent()

      await voiceInput().sendTurn('add a retry', { busy: false })

      expect(mocks.useSendPromptMutateAsync).toHaveBeenCalledWith({
        sessionID: 'test-session',
        text: 'add a retry',
        model: undefined,
        agent: 'default',
      })
    })

    it('rejects when the send fails so the conversation can report it', async () => {
      mocks.useSendPromptMutateAsync.mockRejectedValue(new Error('offline'))
      renderComponent()

      await expect(voiceInput().sendTurn('add a retry', { busy: false })).rejects.toThrow('offline')
    })
  })
})

describe('PromptInput submission', () => {
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

  const renderComponent = (initialOverrides: Partial<typeof defaultProps> = {}) => {
    const queryClient = createTestQueryClient()
    const tree = (overrides: Partial<typeof defaultProps> = {}) => (
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} {...initialOverrides} {...overrides} />
      </QueryClientProvider>
    )
    const view = render(tree())
    return { ...view, rerenderWith: (overrides: Partial<typeof defaultProps>) => view.rerender(tree(overrides)) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSendPromptMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.()
    })
    mocks.sendPromptPending.mockReturnValue(false)
    mocks.useMobile.mockReturnValue(true)
    mocks.useSttAvailability.mockReturnValue({ isEnabled: true, isSupported: true })
    mocks.useVoiceConversation.mockReturnValue(createVoiceConversationControllerMock())
    mocks.useUserBash.mockImplementation((selector) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector) => selector({ setAgent: vi.fn() }))
    mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))
  })

  it('keeps submitted text until send succeeds', () => {
    mocks.useSendPromptMutate.mockImplementation(() => undefined)
    renderComponent()

    const input = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'retry me' } })
    fireEvent.click(screen.getByTitle('Send'))

    expect(input).toHaveValue('retry me')
  })

  it('clears submitted text after send success', async () => {
    renderComponent()

    const input = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'sent message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('clears submitted text once the server confirms it is processing', async () => {
    mocks.useSendPromptMutate.mockImplementation(() => undefined)
    const view = renderComponent()

    const input = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'do the thing' } })
    fireEvent.click(screen.getByTitle('Send'))

    expect(input).toHaveValue('do the thing')

    view.rerenderWith({ isStreamingResponse: true })

    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('allows queuing a follow-up while a non-queued send is pending', () => {
    mocks.sendPromptPending.mockReturnValue(true)
    renderComponent({ isStreamingResponse: true })

    const input = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'follow-up' } })

    const queueButton = screen.getByTitle('Queue message')
    expect(queueButton).not.toBeDisabled()

    fireEvent.click(queueButton)

    const [callArgs] = mocks.useSendPromptMutate.mock.calls[0] as [{ text: string }, unknown]
    expect(callArgs.text).toBe('follow-up')
  })

  it('restores a failed queued prompt when the input is empty', async () => {
    const view = renderComponent({ isStreamingResponse: true })

    const input = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: 'queued message' } })
    fireEvent.click(screen.getByTitle('Queue message'))

    const [callArgs] = mocks.useSendPromptMutate.mock.calls[0] as [{ text: string }, unknown]
    expect(callArgs.text).toBe('queued message')

    await waitFor(() => {
      expect(input).toHaveValue('')
    })

    mocks.useSendErrorStore.mockImplementation((selector) => selector({
      errors: {
        'test-session': {
          sessionID: 'test-session',
          title: 'Error',
          message: 'Queued send failed',
          failedPrompt: 'queued message',
        },
      },
    }))

    view.rerenderWith({})

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('queued message')
    })
  })

  it('clears the restored prompt when the send error resolves', async () => {
    mocks.useSendErrorStore.mockImplementation((selector) => selector({
      errors: {
        'test-session': {
          sessionID: 'test-session',
          title: 'Connection Failed',
          message: 'Could not connect.',
          failedPrompt: 'recovered prompt',
          kind: 'network',
        },
      },
    }))

    const view = renderComponent()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('recovered prompt')
    })

    mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))
    view.rerenderWith({})

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('')
    })
  })

  it('keeps stop available while active with prompt content', () => {
    renderComponent({ isSessionActive: true })

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'draft while active' } })

    expect(screen.getAllByTitle('Stop').length).toBeGreaterThan(0)
  })
})
