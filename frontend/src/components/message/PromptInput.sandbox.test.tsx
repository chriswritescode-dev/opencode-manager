import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'
import { showToast } from '@/lib/toast'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const mocks = vi.hoisted(() => ({
  useServerHealth: vi.fn(),
  useSTT: vi.fn(),
  useMobile: vi.fn(),
  useSendPromptMutate: vi.fn(),
  sendPromptPending: vi.fn(() => false),
  useCommands: vi.fn(),
  useCommandHandler: vi.fn(),
  useFileSearch: vi.fn(),
  useModelSelection: vi.fn(),
  useVariants: vi.fn(),
  useSessionAgent: vi.fn(),
  useAgents: vi.fn(),
  useUserBash: vi.fn(),
  useSessionAgentStore: vi.fn(),
  useSendErrorStore: vi.fn(),
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: mocks.useServerHealth,
}))

vi.mock('@/hooks/useSTT', () => ({
  useSTT: mocks.useSTT,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSendPrompt: () => ({ mutate: mocks.useSendPromptMutate, isPending: mocks.sendPromptPending() }),
  useAbortSession: () => ({ mutate: vi.fn() }),
  useSendShell: () => ({ mutate: vi.fn(), isPending: false }),
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

vi.mock('@/stores/sendErrorStore', () => ({
  useSendErrorStore: mocks.useSendErrorStore,
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({
    hasForSession: vi.fn().mockReturnValue(false),
    setShowDialog: vi.fn(),
  }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}))

vi.mock('@/components/agent/AgentQuickSelect', () => ({
  AgentQuickSelect: () => <div>AgentQuickSelect</div>,
}))

vi.mock('@/components/model/ModelQuickSelect', () => ({
  ModelQuickSelect: () => <div>ModelQuickSelect</div>,
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

const defaultProps = {
  opcodeUrl: 'http://localhost:5551',
  directory: '/test',
  sessionID: 'test-session',
  showScrollButton: false,
  isSessionActive: false,
  isStreamingResponse: false,
  onScrollToBottom: vi.fn(),
}

describe('PromptInput sandbox shell-mode gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.useUserBash.mockImplementation((selector) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector) => selector({ setAgent: vi.fn() }))
    mocks.useSendErrorStore.mockImplementation((selector) => selector({ errors: {} }))
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
  })

  function mockHealth(sandbox?: { available: boolean; enforced: boolean; reason?: string }) {
    mocks.useServerHealth.mockReturnValue({
      data: sandbox === undefined ? undefined : { sandbox },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
      rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    })
  }

  const renderComponent = () => {
    const queryClient = createTestQueryClient()
    return render(
      <QueryClientProvider client={queryClient}>
        <PromptInput {...defaultProps} />
      </QueryClientProvider>
    )
  }

  it('blocks bash mode with an actionable message when the running OpenCode child is enforced', () => {
    mockHealth({ available: true, enforced: true })

    renderComponent()

    const textarea = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(textarea, { target: { value: '!' } })

    expect(screen.getByPlaceholderText('Send a message...')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Enter bash command...')).not.toBeInTheDocument()
    expect(vi.mocked(showToast.error)).toHaveBeenCalledWith(
      expect.stringContaining('shell mode is disabled'),
      expect.objectContaining({ id: 'sandbox-bash-mode-disabled' }),
    )
  })

  it('allows bash mode when enforcement is off', () => {
    mockHealth({ available: true, enforced: false })

    renderComponent()

    const textarea = screen.getByPlaceholderText('Send a message...')
    fireEvent.change(textarea, { target: { value: '!' } })

    expect(screen.getByPlaceholderText('Enter bash command...')).toBeInTheDocument()
    expect(vi.mocked(showToast.error)).not.toHaveBeenCalled()
  })
})
