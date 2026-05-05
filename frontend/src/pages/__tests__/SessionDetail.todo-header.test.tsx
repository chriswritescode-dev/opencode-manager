import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import type { Todo } from '@/components/message/SessionTodoDisplay'
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
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useAbortSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMessages: mocks.useMessages,
  useConfig: mocks.useConfig,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null })),
}))

vi.mock('@/hooks/useOpenCodeClient', () => ({
  useOpenCodeClient: mocks.useOpenCodeClient,
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
  useMobile: vi.fn(() => false),
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: vi.fn(() => ({ keyboardHeight: 0 })),
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({ leaderActive: false })),
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: vi.fn(() => ({ scrollToBottom: vi.fn() })),
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
  useUIState: vi.fn(() => vi.fn()),
}))

vi.mock('@/stores/sessionStatusStore', () => ({
  useSessionStatus: vi.fn(() => ({ setStatus: vi.fn() })),
  useSessionStatusForSession: vi.fn(() => ({ type: 'idle' })),
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

const activeTodos: Todo[] = [
  { id: '1', content: 'Implement mobile header fix', status: 'in_progress', priority: 'high' },
  { id: '2', content: 'Add regression tests', status: 'pending', priority: 'medium' },
  { id: '3', content: 'Verify completed item grouping', status: 'completed', priority: 'low' },
]

describe('SessionDetail todo-header integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionTodos.setState({ todos: new Map() })

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
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      updateSettings: vi.fn(),
    })
    mocks.useSettingsDialog.mockReturnValue({ open: vi.fn() })
    mocks.useMobile.mockReturnValue(false)
    mocks.useVisualViewport.mockReturnValue({ keyboardHeight: 0 })
    mocks.useKeyboardShortcuts.mockReturnValue({ leaderActive: false })
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn() })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSidebarAction.mockReturnValue(undefined)
  })

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

  const renderSessionDetail = (sessionId: string, repoId: number) => {
    return render(
      <MemoryRouter initialEntries={[`/repos/${repoId}/sessions/${sessionId}`]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }

  it('renders SessionTodoDisplay collapsed by default inside SessionDetail header', async () => {
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    renderSessionDetail('session-1', 1)

    await waitFor(() => {
      expect(screen.getByText('Tasks: 1/3 complete')).toBeInTheDocument()
    })

    expect(screen.queryByText('Implement mobile header fix')).not.toBeInTheDocument()
  })

  it('expands todo list when clicked inside SessionDetail header', async () => {
    const user = userEvent.setup()
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    renderSessionDetail('session-1', 1)

    await waitFor(() => {
      expect(screen.getByText('Tasks: 1/3 complete')).toBeInTheDocument()
    })

    const collapsedRow = screen.getByText('Tasks: 1/3 complete')
    await user.click(collapsedRow)

    expect(screen.getByText('Implement mobile header fix')).toBeInTheDocument()
    expect(screen.getByText('Add regression tests')).toBeInTheDocument()

    const expandedContainer = screen.getByTestId('todo-expanded-list')
    expect(expandedContainer).toHaveClass('max-h-[80px]')
    expect(expandedContainer).toHaveClass('sm:max-h-[160px]')
    expect(expandedContainer).toHaveClass('overflow-y-auto')
  })

  it('header wrapper uses max-h-72 sm:max-h-80 and overflow-hidden for proper containment', async () => {
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    renderSessionDetail('session-1', 1)

    await waitFor(() => {
      expect(screen.getByTestId('session-header-region')).toBeInTheDocument()
    })

    const headerRegion = screen.getByTestId('session-header-region')
    
    expect(headerRegion.className).toContain('max-h-72')
    expect(headerRegion.className).toContain('sm:max-h-80')
    expect(headerRegion.className).toContain('overflow-hidden')
    expect(headerRegion.className).not.toContain('max-h-40')
  })

  it('collapses todo list when expanded header is clicked again', async () => {
    const user = userEvent.setup()
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    renderSessionDetail('session-1', 1)

    await waitFor(() => {
      expect(screen.getByText('Tasks: 1/3 complete')).toBeInTheDocument()
    })

    const collapsedRow = screen.getByText('Tasks: 1/3 complete')
    await user.click(collapsedRow)

    expect(screen.getByTestId('todo-expanded-list')).toBeInTheDocument()

    const expandedHeader = screen.getByText('Tasks: 1/3 complete')
    await user.click(expandedHeader)

    expect(screen.queryByTestId('todo-expanded-list')).not.toBeInTheDocument()
  })

  it('does not render SessionTodoDisplay when all tasks are completed', async () => {
    const allCompletedTodos: Todo[] = [
      { id: '1', content: 'Task one', status: 'completed', priority: 'high' },
      { id: '2', content: 'Task two', status: 'completed', priority: 'medium' },
    ]
    useSessionTodos.getState().setTodos('session-1', allCompletedTodos)

    renderSessionDetail('session-1', 1)

    await waitFor(() => {
      const headerRegion = screen.getByTestId('session-header-region')
      expect(headerRegion).toBeInTheDocument()
    })

    expect(screen.queryByText(/Tasks:/)).not.toBeInTheDocument()
  })
})
