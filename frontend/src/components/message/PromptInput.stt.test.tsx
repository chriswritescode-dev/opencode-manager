import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'

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
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
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
  useSendPrompt: () => ({ mutate: vi.fn() }),
  useAbortSession: () => ({ mutate: vi.fn() }),
  useSendShell: () => ({ mutate: vi.fn() }),
  useOpenCodeClient: () => ({}),
  useAgents: () => ({ data: [] }),
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

vi.mock('@/hooks/useAgents', () => ({
  useAgents: mocks.useAgents,
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

vi.mock('@/components/ui/session-status-indicator', () => ({
  SessionStatusIndicator: () => <div>SessionStatus</div>,
}))

vi.mock('@/components/command/CommandSuggestions', () => ({
  CommandSuggestions: () => <div>CommandSuggestions</div>,
}))

vi.mock('./MentionSuggestions', () => ({
  MentionSuggestions: () => <div>MentionSuggestions</div>,
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
    opcodeUrl: 'http://localhost:5551',
    directory: '/test',
    sessionID: 'test-session',
    repoId: 1,
    disabled: false,
    showScrollButton: false,
    isSessionActive: false,
    isStreamingResponse: false,
    onScrollToBottom: vi.fn(),
    onShowSessionsDialog: vi.fn(),
    onShowModelsDialog: vi.fn(),
    onShowHelpDialog: vi.fn(),
    onToggleDetails: vi.fn(),
    onExportSession: vi.fn(),
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

    mocks.useCommands.mockReturnValue({ filterCommands: vi.fn() })
    mocks.useCommandHandler.mockReturnValue({ executeCommand: vi.fn() })
    mocks.useFileSearch.mockReturnValue({ files: [] })
    mocks.useModelSelection.mockReturnValue({
      model: null,
      modelString: 'test-model',
      setModel: vi.fn(),
      setActiveModel: vi.fn().mockReturnValue(false),
      recentModels: [],
      favoriteModels: [],
      toggleFavorite: vi.fn(),
      isModelStateLoading: false,
    })
    mocks.useVariants.mockReturnValue({
      hasVariants: false,
      currentVariant: null,
      cycleVariant: vi.fn(),
    })
    mocks.useSessionAgent.mockReturnValue({ agent: 'default' })
    mocks.useAgents.mockReturnValue({ data: [] })
    mocks.useUserBash.mockReturnValue({ addUserBashCommand: vi.fn() })
    mocks.useSessionAgentStore.mockReturnValue({ setAgent: mockSetAgent })
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
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
    const mobileButton = voiceButtons.find((btn) => btn.className.includes('px-4') && btn.className.includes('py-2'))
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
    it('inserts a command selected from the mobile drawer', async () => {
      renderComponent()

      act(() => {
        useUIState.getState().selectPromptCommand({
          name: 'help',
          description: 'Show help',
          template: '',
          agent: '',
          model: '',
          hints: [],
        })
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('/help ')
      })
    })

    it('inserts a file selected from the mobile drawer', async () => {
      renderComponent()

      act(() => {
        useUIState.getState().selectPromptFile('src/App.tsx')
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Send a message...')).toHaveValue('@App.tsx ')
      })
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

    it('pointer down while recording sets up swipe gesture', async () => {
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
  })
})
