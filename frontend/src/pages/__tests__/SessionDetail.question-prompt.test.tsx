import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { QuestionRequest } from '@/api/types'
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
  useMobile: vi.fn(),
  useAutoScroll: vi.fn(),
  useDialogParam: vi.fn(),
  useSidebarAction: vi.fn(),
  useSessionStatusForSession: vi.fn(),
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
  QuestionPrompt: ({ question }: { question: QuestionRequest }) => (
    <div data-testid="question-prompt">{question.id}</div>
  ),
}))

vi.mock('@/components/session/MinimizedQuestionIndicator', () => ({
  MinimizedQuestionIndicator: vi.fn(() => null),
}))

vi.mock('@/components/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: vi.fn(() => null),
}))

vi.mock('@/components/message/PromptInput', () => ({
  PromptInput: vi.fn(() => <div>MockedPromptInput</div>),
}))

const VIEWED_SESSION_ID = 'viewed-session'

function createQuestion(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [
      {
        question: 'Continue?',
        header: 'Confirm',
        options: [{ label: 'Yes', description: 'Continue' }],
        multiple: false,
      },
    ],
  }
}

const viewedSessionQuestion = createQuestion('question-viewed', VIEWED_SESSION_ID)
const otherSessionQuestion = createQuestion('question-other', 'other-session')

describe('SessionDetail question prompt session scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMessages.mockReturnValue({ data: [], isLoading: false })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      syncForSession: vi.fn(),
    })
    mocks.useSSEHealth.mockReturnValue({ isHealthy: true })
    mocks.useConfig.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useOpenCodeClient.mockReturnValue({})
    mocks.useMobile.mockReturnValue(false)
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn() })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSidebarAction.mockReturnValue(undefined)
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
  })

  const renderWithQuestions = (questionsBySession: Record<string, QuestionRequest>, current: QuestionRequest | null) => {
    mocks.useQuestions.mockReturnValue({
      current,
      getForSession: vi.fn((sessionID: string) => questionsBySession[sessionID] ?? null),
      pendingCount: Object.keys(questionsBySession).length,
      reply: vi.fn(),
      reject: vi.fn(),
      syncForSession: vi.fn(),
    })

    return render(
      <MemoryRouter initialEntries={[`/repos/1/sessions/${VIEWED_SESSION_ID}`]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }

  it('renders the viewed session question when another session owns the globally current question', async () => {
    renderWithQuestions(
      {
        [VIEWED_SESSION_ID]: viewedSessionQuestion,
        'other-session': otherSessionQuestion,
      },
      otherSessionQuestion
    )

    await waitFor(() => {
      expect(screen.getByTestId('question-prompt')).toHaveTextContent('question-viewed')
    })
  })

  it('renders no question prompt when only another session has a pending question', async () => {
    renderWithQuestions({ 'other-session': otherSessionQuestion }, otherSessionQuestion)

    await waitFor(() => expect(screen.getByText('MockedPromptInput')).toBeInTheDocument())
    expect(screen.queryByTestId('question-prompt')).not.toBeInTheDocument()
  })
})
