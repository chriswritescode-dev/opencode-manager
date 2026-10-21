import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { createCommandActionsMock } from '@/test/test-utils'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const mocks = vi.hoisted(() => ({
  useSTT: vi.fn(),
  useMobile: vi.fn(),
  useOpenCode: vi.fn(),
  useCommands: vi.fn(),
  useCommandHandler: vi.fn(),
  useFileSearch: vi.fn(),
  useModelSelection: vi.fn(),
  useVariants: vi.fn(),
  useSessionAgent: vi.fn(),
  useAgents: vi.fn(),
  useSendPromptMutate: vi.fn(),
  sendPromptPending: vi.fn(() => false),
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
  useSendErrorStore: vi.fn(),
  useSettings: vi.fn(),
  EventContext: vi.fn(),
}))

vi.mock('@/hooks/useSTT', () => ({
  useSTT: mocks.useSTT,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSendPrompt: () => ({ mutate: mocks.useSendPromptMutate, isPending: mocks.sendPromptPending() }),
  useInterruptSession: () => ({ mutate: vi.fn() }),
  useSendShell: () => ({ mutate: vi.fn(), isPending: false }),
  useAgents: () => ({ data: [] }),
  useSkills: () => ({ data: [] }),
}))

vi.mock('@/hooks/useCommands', () => ({
  useCommands: mocks.useCommands,
}))

vi.mock('@/hooks/useCommandHandler', () => ({
  useCommandHandler: mocks.useCommandHandler,
}))

vi.mock('@/hooks/useFileSearch', () => ({
  useFileSearch: mocks.useFileSearch,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: mocks.useModelSelection,
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariants: mocks.useVariants,
}))

vi.mock('@/hooks/useSessionAgent', () => ({
  useSessionAgent: mocks.useSessionAgent,
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
  EventContext: mocks.EventContext,
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

interface MockSTTReturn {
  isRecording: boolean
  isProcessing: boolean
  isSupported: boolean
  isEnabled: boolean
  interimTranscript: string
  transcript: string
  startRecording: ReturnType<typeof vi.fn>
  stopRecording: ReturnType<typeof vi.fn>
  abortRecording: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}

describe('PromptInput STT Gesture Tests', () => {
  const mockStartRecording = vi.fn()
  const mockStopRecording = vi.fn()
  const mockAbortRecording = vi.fn()
  const mockReset = vi.fn()
  const mockClear = vi.fn()
  const mockSetAgent = vi.fn()

  const defaultProps = {
    directory: '/test',
    sessionID: 'test-session',
    repoId: 1,
    showScrollButton: false,
    isSessionActive: false,
    isStreamingResponse: false,
    onScrollToBottom: vi.fn(),
    commandActions: createCommandActionsMock(),
    onPromptChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStartRecording.mockResolvedValue(true)
    mockStopRecording.mockReturnValue(undefined)
    mockAbortRecording.mockReturnValue(undefined)
    mockReset.mockReturnValue(undefined)
    mockClear.mockReturnValue(undefined)
    mockSetAgent.mockClear()
    mocks.useSendPromptMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.()
    })
    mocks.sendPromptPending.mockReturnValue(false)

    mocks.useMobile.mockReturnValue(true)
    mocks.useSTT.mockReturnValue({
      isRecording: false,
      isProcessing: false,
      isSupported: true,
      isEnabled: true,
      interimTranscript: '',
      transcript: '',
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      abortRecording: mockAbortRecording,
      reset: mockReset,
      clear: mockClear,
    } as unknown as MockSTTReturn)

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
    mocks.useVariants.mockReturnValue({
      hasVariants: false,
      currentVariant: null,
      cycleVariant: vi.fn(),
    })
    mocks.useSessionAgent.mockReturnValue({ agent: 'default' })
    mocks.useAgents.mockReturnValue({ data: [] })
    mocks.useUserBash.mockImplementation((selector) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector) => selector({ setAgent: mockSetAgent }))
    mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))
  })

  const renderComponent = (sttOverrides: Partial<MockSTTReturn> = {}) => {
    const queryClient = createTestQueryClient()
    mocks.useSTT.mockReturnValue({
      isRecording: false,
      isProcessing: false,
      isSupported: true,
      isEnabled: true,
      interimTranscript: '',
      transcript: '',
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      abortRecording: mockAbortRecording,
      reset: mockReset,
      clear: mockClear,
      ...sttOverrides,
    } as unknown as MockSTTReturn)
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} />
      </QueryClientProvider>
    )
  }

  const getMobileVoiceButton = () => {
    const allButtons = screen.getAllByRole('button')
    const voiceButtons = allButtons.filter((btn) => {
      const title = (btn.getAttribute('title') || '').toLowerCase()
      return title.includes('tap to speak') || title.includes('tap to transcribe') || title.includes('hold to speak') || title.includes('release')
    })
    if (voiceButtons.length === 0) {
      throw new Error('No voice button found. Available buttons: ' + allButtons.map(b => b.getAttribute('title')).join(', '))
    }
    const mobileButton = voiceButtons.find((btn) => btn.getAttribute('data-voice-variant') === 'mobile')
    return mobileButton || voiceButtons[0]
  }

  const getMobileVoiceButtonContainer = () => {
    const mobileButton = getMobileVoiceButton()
    const container = mobileButton.parentElement
    if (!container) {
      throw new Error('Mobile voice button container not found')
    }
    return container
  }

  describe('quick tap behavior', () => {
    it('keeps submitted text until send succeeds', async () => {
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
      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} />
        </QueryClientProvider>,
      )

      const input = screen.getByPlaceholderText('Send a message...')
      fireEvent.change(input, { target: { value: 'do the thing' } })
      fireEvent.click(screen.getByTitle('Send'))

      expect(input).toHaveValue('do the thing')

      rerender(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} isStreamingResponse />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('allows queuing a follow-up while a non-queued send is pending', async () => {
      mocks.sendPromptPending.mockReturnValue(true)
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <PromptInput {...defaultProps} isStreamingResponse />
        </QueryClientProvider>,
      )

      const input = screen.getByPlaceholderText('Send a message...')
      fireEvent.change(input, { target: { value: 'follow-up' } })

      const queueButton = screen.getByTitle('Queue message')
      expect(queueButton).not.toBeDisabled()

      fireEvent.click(queueButton)

      const [callArgs] = mocks.useSendPromptMutate.mock.calls[0] as [{ text: string }, unknown]
      expect(callArgs.text).toBe('follow-up')
    })

    it('restores a failed queued prompt when the input is empty', async () => {
      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} isStreamingResponse />
        </QueryClientProvider>,
      )

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

      rerender(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('queued message')
      })
    })

    it('clears the restored prompt when the send error resolves', async () => {
      const queryClient = createTestQueryClient()
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

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('recovered prompt')
      })

      mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))

      rerender(
        <QueryClientProvider client={queryClient}>
          <PromptInput {...defaultProps} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('')
      })
    })

    it('keeps stop available while active with prompt content', async () => {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <PromptInput {...defaultProps} isSessionActive />
        </QueryClientProvider>
      )

      const input = screen.getByPlaceholderText('Send a message...')
      fireEvent.change(input, { target: { value: 'draft while active' } })

      expect(screen.getAllByTitle('Stop').length).toBeGreaterThan(0)
    })

    it('quick tap starts recording through click only', async () => {
      mockStartRecording.mockResolvedValue(true)

      renderComponent()

      const container = getMobileVoiceButtonContainer()
      const button = getMobileVoiceButton()

      await act(async () => {
        fireEvent.pointerDown(container)
        fireEvent.pointerUp(container)
        fireEvent.click(button)
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      await waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1)
      })

      expect(mockStopRecording).not.toHaveBeenCalled()
    })

    it('quick tap does not start recording on pointerdown alone', async () => {
      mockStartRecording.mockResolvedValue(true)

      renderComponent()

      const container = getMobileVoiceButtonContainer()
      const button = getMobileVoiceButton()

      await act(async () => {
        fireEvent.pointerDown(container)
        fireEvent.pointerUp(container)
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      expect(mockStartRecording).not.toHaveBeenCalled()

      await act(async () => {
        fireEvent.click(button)
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      await waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1)
      })
    })

    it('pointer down while recording starts a drag gesture', async () => {
      renderComponent({ isRecording: true })

      const container = getMobileVoiceButtonContainer()

      await act(async () => {
        fireEvent.pointerDown(container)
      })

      expect(mockStartRecording).not.toHaveBeenCalled()
      expect(mockStopRecording).not.toHaveBeenCalled()
    })

    it('second tap while recording stops', async () => {
      renderComponent({ isRecording: true })

      const container = getMobileVoiceButtonContainer()
      const button = getMobileVoiceButton()

      await act(async () => {
        fireEvent.pointerDown(container)
        fireEvent.pointerUp(container)
        fireEvent.click(button)
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      await waitFor(() => {
        expect(mockStopRecording).toHaveBeenCalledTimes(1)
      })
      expect(mockStartRecording).not.toHaveBeenCalled()
    })

    it('component sets up outside press handler when recording', async () => {
      renderComponent({ isRecording: true })

      expect(document.body.onclick).toBeDefined()
    })

    it('failed start clears toggling state', async () => {
      mockStartRecording.mockResolvedValue(false)

      renderComponent()

      const button = getMobileVoiceButton()

      await act(async () => {
        fireEvent.pointerDown(button)
        fireEvent.pointerUp(button)
        fireEvent.click(button)
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      await waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1)
      })
    })

    it('renders mobile mic even when showScrollButton is true and no voice feedback is active', async () => {
      mocks.useMobile.mockReturnValue(true)

      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <PromptInput {...defaultProps} showScrollButton={true} />
        </QueryClientProvider>
      )

      const allButtons = screen.getAllByRole('button')
      const voiceButtons = allButtons.filter((btn) => {
        const title = (btn.getAttribute('title') || '').toLowerCase()
        return title.includes('tap to speak') || title.includes('tap to transcribe') || title.includes('hold to speak')
      })

      expect(voiceButtons.length).toBeGreaterThan(0)
    })

    it('renders the mobile scroll-to-bottom button when showScrollButton is true', async () => {
      mocks.useMobile.mockReturnValue(true)

      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <PromptInput {...defaultProps} showScrollButton={true} />
        </QueryClientProvider>
      )

      expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument()
      expect(screen.queryByText('Latest')).not.toBeInTheDocument()
    })
  })

  describe('mobile voice vs submit button', () => {
    const queryMobileVoiceButton = () => {
      const voiceButtons = screen.getAllByRole('button').filter((btn) => {
        const title = (btn.getAttribute('title') || '').toLowerCase()
        return title.includes('tap to speak') || title.includes('tap to transcribe') || title.includes('hold to speak') || title.includes('release')
      })
      return voiceButtons.find((btn) => btn.getAttribute('data-voice-variant') === 'mobile') ?? null
    }

    it('shows the mobile mic and no submit button when the prompt is empty', () => {
      renderComponent()

      expect(queryMobileVoiceButton()).not.toBeNull()
      expect(screen.queryByTitle('Send')).not.toBeInTheDocument()
    })

    it('shows the submit button and keeps the mobile mic once the prompt has content', () => {
      renderComponent()

      fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'hello' } })

      expect(screen.getByTitle('Send')).toBeInTheDocument()
      expect(queryMobileVoiceButton()).not.toBeNull()
    })

    it('keeps the mobile mic visible while recording even with prompt content', () => {
      renderComponent({ isRecording: true })

      fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'hello' } })

      expect(queryMobileVoiceButton()).not.toBeNull()
    })
  })

  describe('in-row mobile voice recorder', () => {
    const renderRecorder = (sttOverrides: Partial<MockSTTReturn> = {}) => {
      const queryClient = createTestQueryClient()
      const buildTree = (overrides: Partial<MockSTTReturn>) => {
        mocks.useSTT.mockReturnValue({
          isRecording: false,
          isProcessing: false,
          isSupported: true,
          isEnabled: true,
          interimTranscript: '',
          transcript: '',
          startRecording: mockStartRecording,
          stopRecording: mockStopRecording,
          abortRecording: mockAbortRecording,
          reset: mockReset,
          clear: mockClear,
          ...overrides,
        } as unknown as MockSTTReturn)
        return (
          <QueryClientProvider client={queryClient}>
            <PromptInput {...defaultProps} onPromptChange={(hasContent) => defaultProps.onPromptChange(hasContent)} />
          </QueryClientProvider>
        )
      }

      const view = render(buildTree(sttOverrides))
      return { rerender: (overrides: Partial<MockSTTReturn>) => view.rerender(buildTree(overrides)) }
    }

    const getControlsRow = () => screen.getByTestId('composer-controls-row')

    it('swaps the controls row for discard, strip, mic and send while recording', () => {
      renderComponent({ isRecording: true })

      const row = getControlsRow()

      expect(within(row).getByRole('button', { name: 'Discard recording' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Send recording' })).toBeInTheDocument()
      expect(within(row).getByText('0:00')).toBeInTheDocument()
      expect(within(row).getByRole('status')).toHaveTextContent('‹ discard · send ›')
    })

    it('hides the mobile insert keys and renders nothing above the mic', () => {
      renderComponent({ isRecording: true })

      fireEvent.focus(screen.getByPlaceholderText('Send a message...'))

      expect(screen.queryByRole('toolbar', { name: 'Insert' })).not.toBeInTheDocument()
      expect(getMobileVoiceButtonContainer().children).toHaveLength(1)
    })

    it('stops recording and marks the transcript for auto-send when send is tapped', async () => {
      const view = renderRecorder({ isRecording: true })

      fireEvent.click(screen.getByRole('button', { name: 'Send recording' }))

      expect(mockStopRecording).toHaveBeenCalledTimes(1)

      view.rerender({ isRecording: false, isProcessing: true })

      expect(screen.getByText('Transcribing & sending…')).toBeInTheDocument()

      view.rerender({ isRecording: false, isProcessing: false, transcript: 'hello there' })

      await waitFor(() => {
        const [variables] = mocks.useSendPromptMutate.mock.calls[0] as [{ text: string }]
        expect(variables.text).toBe('hello there')
      })
    })

    it('upgrades a transcription in progress to send when send is tapped', async () => {
      const view = renderRecorder({ isRecording: false, isProcessing: true })

      expect(screen.getByText('Transcribing…')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Send recording' }))

      expect(mockStopRecording).not.toHaveBeenCalled()

      view.rerender({ isRecording: false, isProcessing: false, transcript: 'upgraded text' })

      await waitFor(() => {
        const [variables] = mocks.useSendPromptMutate.mock.calls[0] as [{ text: string }]
        expect(variables.text).toBe('upgraded text')
      })
    })

    it('aborts recording when discard is tapped', () => {
      renderComponent({ isRecording: true })
      mockAbortRecording.mockClear()

      const discardButton = screen.getByRole('button', { name: 'Discard recording' })

      fireEvent.pointerDown(discardButton)
      fireEvent.click(discardButton)

      expect(mockAbortRecording).toHaveBeenCalledTimes(1)
      expect(mockStopRecording).not.toHaveBeenCalled()
    })

    it('arms send on a right drag and sends on release', async () => {
      renderComponent({ isRecording: true })

      const container = getMobileVoiceButtonContainer()

      await act(async () => {
        fireEvent.pointerDown(container, { clientX: 100 })
        fireEvent.pointerMove(container, { clientX: 130 })
      })

      expect(screen.getByText('Release to send')).toBeInTheDocument()
      expect(mockStopRecording).not.toHaveBeenCalled()

      await act(async () => {
        fireEvent.pointerUp(container, { clientX: 130 })
      })

      expect(mockStopRecording).toHaveBeenCalledTimes(1)
    })

    it('arms discard on a left drag past the threshold and aborts on release', async () => {
      renderComponent({ isRecording: true })
      mockAbortRecording.mockClear()

      const container = getMobileVoiceButtonContainer()

      await act(async () => {
        fireEvent.pointerDown(container, { clientX: 200 })
        fireEvent.pointerMove(container, { clientX: 100 })
      })

      expect(screen.getByText('Release to discard')).toBeInTheDocument()

      await act(async () => {
        fireEvent.pointerUp(container, { clientX: 100 })
      })

      expect(mockAbortRecording).toHaveBeenCalledTimes(1)
      expect(mockStopRecording).not.toHaveBeenCalled()
    })

    it('leaves the desktop composer without the recorder row', () => {
      mocks.useMobile.mockReturnValue(false)

      renderComponent({ isRecording: true })

      expect(screen.queryByRole('button', { name: 'Discard recording' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send recording' })).not.toBeInTheDocument()
      expect(screen.queryByText('Release to send')).not.toBeInTheDocument()
      expect(document.querySelector('[data-voice-variant="desktop"]')).not.toBeNull()
    })
  })
})
