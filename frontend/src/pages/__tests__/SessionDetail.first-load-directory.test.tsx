import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  RepoSkillsDialog: vi.fn(() => null),
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
  useSettings: mocks.useSettings,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: mocks.useSettingsDialog,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))

vi.mock('@/hooks/useVisualViewport', () => ({
  useVisualViewport: mocks.useVisualViewport,
}))

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: mocks.useKeyboardShortcuts,
}))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: mocks.useAutoScroll,
}))

vi.mock('@/hooks/useDialogParam', () => ({
  useDialogParam: mocks.useDialogParam,
}))

vi.mock('@/hooks/useSidebarAction', () => ({
  useSidebarAction: mocks.useSidebarAction,
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
  getRepo: vi.fn(() => new Promise(() => {})),
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

vi.mock('@/components/message/MessageSkeleton', () => ({
  MessageSkeleton: vi.fn(() => <div>Messages loading skeleton</div>),
}))

vi.mock('@/components/message/MessageThread', () => ({
  MessageThread: vi.fn(() => <div>Messages rendered</div>),
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
  RepoSkillsDialog: mocks.RepoSkillsDialog,
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

describe('SessionDetail first-load navigation directory', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

  const renderSession = (initialEntry: string | { pathname: string; state?: unknown }) => render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={createQueryClient()}>
        <Routes>
          <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  )

  it('uses the router-state directory on first render while the repo is loading', async () => {
    renderSession({ pathname: '/repos/7/sessions/sess-x', state: { directory: '/abs/other-repo' } })

    await waitFor(() => {
      const call = mocks.useMessages.mock.calls[mocks.useMessages.mock.calls.length - 1]
      expect(call?.[2]).toBe('/abs/other-repo')
    })

    const sessionCall = mocks.useSession.mock.calls[mocks.useSession.mock.calls.length - 1]
    expect(sessionCall?.[2]).toBe('/abs/other-repo')
  })

  it('leaves directory undefined on first render without router state while the repo is loading', async () => {
    renderSession('/repos/7/sessions/sess-x')

    await waitFor(() => {
      const call = mocks.useMessages.mock.calls[mocks.useMessages.mock.calls.length - 1]
      expect(call?.[2]).toBeUndefined()
    })

    const sessionCall = mocks.useSession.mock.calls[mocks.useSession.mock.calls.length - 1]
    expect(sessionCall?.[2]).toBeUndefined()
  })

  it('renders messages instead of the skeleton when assistant navigation provides directory while the repo is loading', async () => {
    const { queryByText, getByText } = renderSession({
      pathname: '/repos/0/sessions/sess-assistant',
      state: { directory: '/abs/assistant' },
    })

    await waitFor(() => {
      expect(getByText('Messages rendered')).toBeTruthy()
    })

    expect(queryByText('Messages loading skeleton')).toBeNull()
  })
})
