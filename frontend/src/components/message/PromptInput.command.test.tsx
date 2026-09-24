import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptInput } from './PromptInput'
import { useUIState } from '@/stores/uiStateStore'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  switchSessionModel: vi.fn(),
  switchSessionAgent: vi.fn(),
  compactSession: vi.fn(),
  agents: [] as Array<{ name: string; description?: string }>,
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
    compactSession: mocks.compactSession,
    switchSessionModel: mocks.switchSessionModel,
    switchSessionAgent: mocks.switchSessionAgent,
  }
})

vi.mock('@/hooks/useOpenCode', async () => {
  const actual = await vi.importActual('@/hooks/useOpenCode')
  return {
    ...actual,
    useAgents: () => ({ data: mocks.agents }),
    useOpenCodeClient: () => null,
  }
})

vi.mock('@/hooks/useSTT', () => ({ useSTT: mocks.useSTT }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))
vi.mock('@/hooks/useCommands', () => ({ useCommands: mocks.useCommands }))
vi.mock('@/hooks/useFileSearch', () => ({ useFileSearch: mocks.useFileSearch }))
vi.mock('@/hooks/useModelSelection', () => ({ useModelSelection: mocks.useModelSelection }))
vi.mock('@/hooks/useVariants', () => ({ useVariants: mocks.useVariants }))
vi.mock('@/hooks/useSessionAgent', () => ({ useSessionAgent: mocks.useSessionAgent }))
vi.mock('@/stores/userBashStore', () => ({ useUserBash: mocks.useUserBash }))
vi.mock('@/stores/sessionAgentStore', () => ({ useSessionAgentStore: mocks.useSessionAgentStore }))
vi.mock('@/stores/sendErrorStore', () => ({ useSendErrorStore: mocks.useSendErrorStore }))

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
    onShowSessionsDialog: vi.fn(),
    onShowHelpDialog: vi.fn(),
    onToggleDetails: vi.fn(),
    onExportSession: vi.fn(),
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
    mocks.agents = [{ name: 'reviewer', description: 'Reviewer' }]
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
      filterCommands: (query: string) => query === 'review' ? [{ name: 'review', description: 'Review' }] : [],
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
    mocks.useVariants.mockReturnValue({ hasVariants: false, currentVariant: null, cycleVariant: vi.fn() })
    mocks.useSessionAgent.mockReturnValue({ agent: 'build' })
    mocks.useUserBash.mockImplementation((selector: (state: unknown) => unknown) => selector({ addUserBashCommand: vi.fn() }))
    mocks.useSessionAgentStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ setAgent: vi.fn() }))
    mocks.useSendErrorStore.mockImplementation((selector: (state: unknown) => unknown) => selector({ errors: {} }))
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
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

  it('preserves the submitted command text when the command submission fails', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('command failed'))
    renderComponent()

    const input = await screen.findByPlaceholderText('Send a message...')
    fireEvent.change(input, { target: { value: '/review' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(mocks.runCommand).toHaveBeenCalled())
    expect(input).toHaveValue('/review')
  })
})
