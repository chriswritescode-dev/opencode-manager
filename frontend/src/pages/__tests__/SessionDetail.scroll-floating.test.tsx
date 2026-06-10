import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { SessionDetail } from '../SessionDetail'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useMessages: vi.fn(),
  useSSE: vi.fn(),
  useRepoActivity: vi.fn(),
  usePermissions: vi.fn(),
  useQuestions: vi.fn(),
  useSSEHealth: vi.fn(),
  useConfig: vi.fn(),
  useOpenCodeClient: vi.fn(),
  useSettings: vi.fn(),
  useSettingsDialog: vi.fn(),
  useMobile: vi.fn(),
  useVisualViewport: vi.fn(),
  useKeyboardShortcuts: vi.fn(),
  useAutoScroll: vi.fn(),
  useDialogParam: vi.fn(),
  useSidebarAction: vi.fn(),
  useSessionStatusForSession: vi.fn(),
  PromptInput: vi.fn(),
}))

vi.mock('@/config', () => ({
  OPENCODE_API_ENDPOINT: 'http://localhost:5551/api/opencode',
  API_BASE_URL: 'http://localhost:5551',
  SERVER_PORT: 5003,
  OPENCODE_PORT: 5551,
  FILE_LIMITS: {},
  DEFAULTS: {},
  ALLOWED_MIME_TYPES: [],
  GIT_PROVIDERS: [],
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useAbortSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMessages: mocks.useMessages,
  useConfig: mocks.useConfig,
  useSendPrompt: vi.fn(() => ({ mutate: vi.fn() })),
  useSendShell: vi.fn(() => ({ mutate: vi.fn() })),
  useAgents: vi.fn(() => ({ data: [] })),
  useOpenCodeClient: mocks.useOpenCodeClient,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null })),
}))

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({
    preferences: { expandToolCalls: false },
    updateSettings: vi.fn(),
  })),
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: vi.fn(() => ({ open: vi.fn() })),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: vi.fn(() => ({ keyboardHeight: 0 })),
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({ leaderActive: false })),
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: mocks.useAutoScroll,
}))

vi.mock('@/hooks/useDialogParam', () => ({
  useDialogParam: vi.fn(() => [false, vi.fn()]),
}))

vi.mock('@/hooks/useSidebarAction', () => ({
  useSidebarAction: vi.fn(() => {}),
}))

vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))

vi.mock('@/stores/uiStateStore', () => ({
  useUIState: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    typeof selector === 'function'
      ? selector({ isEditingMessage: false, setActivePromptFileBasePath: vi.fn() })
      : false
  ),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => ({ setStatus: vi.fn() })),
  useSessionStatusForSession: mocks.useSessionStatusForSession,
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: mocks.useSSE,
}))

vi.mock('@/hooks/useRepoActivity', () => ({
  useRepoActivity: mocks.useRepoActivity,
}))

vi.mock('@/contexts/EventContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    usePermissions: mocks.usePermissions,
    useQuestions: mocks.useQuestions,
    useSSEHealth: mocks.useSSEHealth,
  }
})

vi.mock('@/api/repos', () => ({
  getRepo: vi.fn(() => Promise.resolve({
    id: 1,
    repoUrl: 'https://github.com/test/repo',
    localPath: '/test/repo',
    sourcePath: null,
    fullPath: '/test/repo',
    branch: 'main',
    currentBranch: 'main',
    fullSlug: 'test/repo',
    repoType: 'github' as const,
  })),
  initializeAssistantMode: vi.fn(() => Promise.resolve({ directory: '/test/repo' })),
}))

vi.mock('@/components/model/ModelSelectDialog', () => ({
  ModelSelectDialog: vi.fn(() => null),
}))

vi.mock('@/components/session/SessionList', () => ({
  SessionList: vi.fn(() => null),
}))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: vi.fn(() => null),
}))

vi.mock('@/components/repo/RepoMcpDialog', () => ({
  RepoMcpDialog: vi.fn(() => null),
}))

vi.mock('@/components/repo/ResetPermissionsDialog', () => ({
  ResetPermissionsDialog: vi.fn(() => null),
}))

vi.mock('@/components/repo/RepoLspDialog', () => ({
  RepoLspDialog: vi.fn(() => null),
}))

vi.mock('@/components/repo/RepoSkillsDialog', () => ({
  RepoSkillsDialog: vi.fn(() => null),
}))

vi.mock('@/components/source-control', () => ({
  SourceControlPanel: vi.fn(() => null),
}))

vi.mock('@/components/session/QuestionPrompt', () => ({
  QuestionPrompt: vi.fn(() => null),
}))

vi.mock('@/components/session/MinimizedQuestionIndicator', () => ({
  MinimizedQuestionIndicator: vi.fn(() => null),
}))

vi.mock('@/components/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: vi.fn(() => null),
}))

vi.mock('@/components/message/PromptInput', () => ({
  PromptInput: mocks.PromptInput,
}))

describe('SessionDetail scroll floating button', () => {
  let mockScrollToBottom: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockScrollToBottom = vi.fn()

    mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMessages.mockReturnValue({ data: [], isLoading: false })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      hasPermissionsForSession: vi.fn(() => false),
      syncForSession: vi.fn(),
    })
    mocks.useQuestions.mockReturnValue({
      current: null,
      pendingCount: 0,
      hasQuestionsForSession: vi.fn(() => false),
      reply: vi.fn(),
      reject: vi.fn(),
      syncForSession: vi.fn(),
    })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true })
    mocks.useConfig.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useOpenCodeClient.mockReturnValue({})
    mocks.useVisualViewport.mockReturnValue({ keyboardHeight: 0 })
    mocks.useKeyboardShortcuts.mockReturnValue({ leaderActive: false })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSidebarAction.mockReturnValue(undefined)
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
    mocks.PromptInput.mockImplementation(() => <div>MockedPromptInput</div>)
  })

  const createQueryClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const renderWith = (opts: {
    mobile: boolean
    showScrollButton: boolean
    promptContent?: boolean
    sessionActive?: boolean
  }) => {
    mocks.useMobile.mockReturnValue(opts.mobile)
    mocks.useSessionStatusForSession.mockReturnValue({ type: opts.sessionActive ? 'busy' : 'idle' })
    mocks.useAutoScroll.mockImplementation(
      ({ onScrollStateChange }: { onScrollStateChange?: (v: boolean) => void }) => {
        if (opts.showScrollButton) {
          Promise.resolve().then(() => onScrollStateChange?.(true))
        }
        return { scrollToBottom: mockScrollToBottom }
      }
    )

    mocks.PromptInput.mockImplementation((props: { onPromptChange?: (hasContent: boolean) => void; showScrollButton?: boolean; onScrollToBottom: () => void }) => {
      const { onPromptChange } = props
      useEffect(() => {
        onPromptChange?.(opts.promptContent ?? false)
      }, [onPromptChange])

      return (
        <div>
          <span>MockedPromptInput</span>
          {props.showScrollButton && (
            <button type="button" title="Scroll to bottom" aria-label="Scroll to bottom" onClick={props.onScrollToBottom}>
              Latest
            </button>
          )}
        </div>
      )
    })

    return render(
      <MemoryRouter initialEntries={['/repos/1/sessions/test-session']}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }

  it('passes scroll button state to PromptInput when showScrollButton is true', async () => {
    renderWith({ mobile: true, showScrollButton: true })

    await waitFor(() => {
      expect(screen.getByTitle('Scroll to bottom')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Scroll to bottom')).toBeInTheDocument()
  })

  it('still passes scroll button state when content height is below tall threshold', async () => {
    renderWith({ mobile: true, showScrollButton: true })

    await waitFor(() => {
      expect(screen.getByLabelText('Scroll to bottom')).toBeInTheDocument()
    })
  })

  it('does NOT pass scroll button state when mobile + tall content but no showScrollButton', async () => {
    renderWith({ mobile: true, showScrollButton: false })

    await waitFor(() => expect(screen.getByText('MockedPromptInput')).toBeInTheDocument())
    expect(screen.queryByLabelText('Scroll to bottom')).not.toBeInTheDocument()
  })

  it('passes scroll button state on desktop for PromptInput desktop handling', async () => {
    renderWith({ mobile: false, showScrollButton: true })

    await waitFor(() => {
      expect(screen.getByLabelText('Scroll to bottom')).toBeInTheDocument()
    })
  })

  it('does NOT pass scroll button state when prompt has content', async () => {
    renderWith({ mobile: true, showScrollButton: true, promptContent: true })

    await waitFor(() => expect(screen.getByText('MockedPromptInput')).toBeInTheDocument())
    expect(screen.queryByLabelText('Scroll to bottom')).not.toBeInTheDocument()
  })

  it('shows clear button for prompt content only when session is idle', async () => {
    renderWith({ mobile: true, showScrollButton: false, promptContent: true })

    await waitFor(() => expect(screen.getByLabelText('Clear')).toBeInTheDocument())
  })

  it('does not show clear button for prompt content while session is active', async () => {
    renderWith({ mobile: true, showScrollButton: false, promptContent: true, sessionActive: true })

    await waitFor(() => expect(screen.getByText('MockedPromptInput')).toBeInTheDocument())
    expect(screen.queryByLabelText('Clear')).not.toBeInTheDocument()
  })

  it('clicking PromptInput scroll button calls scrollToBottom from useAutoScroll', async () => {
    renderWith({ mobile: true, showScrollButton: true })

    await waitFor(() => {
      expect(screen.getByLabelText('Scroll to bottom')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Scroll to bottom'))
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
  })
})
