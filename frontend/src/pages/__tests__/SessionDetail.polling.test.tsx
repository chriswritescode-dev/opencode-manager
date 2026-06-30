import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  syncPermissionsForSession: vi.fn(),
  syncQuestionsForSession: vi.fn(),
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

vi.mock('@/components/model/ModelSelectDialog', () => ({ ModelSelectDialog: vi.fn(() => null) }))
vi.mock('@/components/session/SessionList', () => ({ SessionList: vi.fn(() => null) }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoLspDialog', () => ({ RepoLspDialog: vi.fn(() => null) }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: vi.fn(() => null) }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: vi.fn(() => null) }))
vi.mock('@/components/session/QuestionPrompt', () => ({ QuestionPrompt: vi.fn(() => null) }))
vi.mock('@/components/session/MinimizedQuestionIndicator', () => ({ MinimizedQuestionIndicator: vi.fn(() => null) }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: vi.fn(() => null) }))

const findPendingActionsQuery = (queryClient: QueryClient): Query | undefined =>
  queryClient
    .getQueryCache()
    .getAll()
    .find((query) => query.queryKey[1] === 'pending-actions')

describe('SessionDetail pending-actions polling gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useSession.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMessages.mockReturnValue({ data: [], isLoading: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      hasPermissionsForSession: vi.fn(() => false),
      syncForSession: mocks.syncPermissionsForSession,
    })
    mocks.useQuestions.mockReturnValue({
      current: null,
      pendingCount: 0,
      hasQuestionsForSession: vi.fn(() => false),
      reply: vi.fn(),
      reject: vi.fn(),
      syncForSession: mocks.syncQuestionsForSession,
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
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })
  })

  const createQueryClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const renderSessionDetail = (queryClient: QueryClient) =>
    render(
      <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

  it('polls on the sync interval when disconnected and the session is active', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(30000)
  })

  it('does not poll while the SSE stream is connected', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'busy' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(false)
  })

  it('does not poll when disconnected but the session is idle with no incomplete messages', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: false })
    mocks.useSessionStatusForSession.mockReturnValue({ type: 'idle' })

    const queryClient = createQueryClient()
    renderSessionDetail(queryClient)

    await waitFor(() => {
      expect(findPendingActionsQuery(queryClient)).toBeDefined()
    })

    const query = findPendingActionsQuery(queryClient)
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(false)
  })
})
