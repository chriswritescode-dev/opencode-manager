import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FetchError } from '@/api/fetchWrapper'
import { LocationCatcher } from '@/test/test-utils'
import { SessionDetail } from '../SessionDetail'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useSessionTranscript: vi.fn(),
  useSSE: vi.fn(),
  useRepoActivity: vi.fn(),
  useRepoSiblings: vi.fn(),
  usePermissions: vi.fn(),
  useForms: vi.fn(),
  useSettings: vi.fn(),
  useSettingsDialog: vi.fn(),
  useMobile: vi.fn(),
  useVisualViewport: vi.fn(),
  useShortcutActions: vi.fn(),
  useAutoScroll: vi.fn(),
  useDialogParam: vi.fn(),
  useTerminalDialogParam: vi.fn(),
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  getRepo: vi.fn(),
  useSessionStatus: vi.fn(),
  PromptInput: vi.fn(() => null),
  MessageThread: vi.fn(() => <div data-testid="message-thread" />),
}))

vi.mock('@/api/repos', () => ({ getRepo: mocks.getRepo }))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useInterruptSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))

vi.mock('@/hooks/useSessionTranscript', () => ({ useSessionTranscript: mocks.useSessionTranscript }))
vi.mock('@/hooks/useRepoSiblings', () => ({ useRepoSiblings: mocks.useRepoSiblings }))
vi.mock('@/hooks/useRepoActivity', () => ({ useRepoActivity: mocks.useRepoActivity }))
vi.mock('@/hooks/useSSE', () => ({ useSSE: mocks.useSSE }))
vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))
vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: vi.fn(() => ({ model: null, modelString: null, modelRef: null })),
}))
vi.mock('@/hooks/useTTS', () => ({ useTTS: vi.fn(() => ({ isEnabled: false })) }))
vi.mock('@/hooks/useSettings', () => ({ useSettings: mocks.useSettings }))
vi.mock('@/hooks/useSettingsDialog', () => ({ useSettingsDialog: mocks.useSettingsDialog }))
vi.mock('@/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))
vi.mock('@/hooks/useVisualViewport', () => ({ useVisualViewport: mocks.useVisualViewport }))
vi.mock('@/contexts/KeyboardShortcutsContext', () => ({ useShortcutActions: mocks.useShortcutActions }))
vi.mock('@/hooks/useAutoScroll', () => ({ useAutoScroll: mocks.useAutoScroll }))
vi.mock('@/hooks/useDialogParam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDialogParam')>()
  return { ...actual, useDialogParam: mocks.useDialogParam }
})
vi.mock('@/hooks/useOpenTerminal', () => ({ useTerminalDialogParam: mocks.useTerminalDialogParam }))
vi.mock('@/hooks/useAutoPlayLastResponse', () => ({
  getAssistantText: vi.fn(() => ''),
  getLatestPlayableAssistantMessage: vi.fn(() => null),
  useAutoPlayLastResponse: vi.fn(() => {}),
}))
vi.mock('@/hooks/useAutoOpenWalkthrough', () => ({ useAutoOpenWalkthrough: vi.fn(() => {}) }))
vi.mock('@/hooks/useSpeakVisibleMessages', () => ({ useSpeakVisibleMessages: vi.fn(() => vi.fn()) }))
vi.mock('@/hooks/useUndoMessage', () => ({
  useUndoMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useRedoMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}))
vi.mock('@/stores/uiStateStore', () => ({ useUIState: vi.fn(() => false) }))
vi.mock('@/stores/sessionStatusStore', () => ({ useSessionStatus: mocks.useSessionStatus }))
vi.mock('@/contexts/EventContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/EventContext')>()
  return { ...actual, usePermissions: mocks.usePermissions, useForms: mocks.useForms }
})

vi.mock('@/components/message/MessageThread', () => ({ MessageThread: mocks.MessageThread }))
vi.mock('@/components/message/PromptInput', () => ({ PromptInput: mocks.PromptInput }))
vi.mock('@/components/message/FloatingTTSButton', () => ({ FloatingTTSButton: () => null }))
vi.mock('@/components/message/MessageSkeleton', () => ({ MessageSkeleton: () => null }))
vi.mock('@/components/session/ContextUsageIndicator', () => ({ ContextUsageIndicator: () => null }))
vi.mock('@/components/session/SessionSendErrorBanner', () => ({ SessionSendErrorBanner: () => null }))
vi.mock('@/components/session/BackgroundWorkBar', () => ({ BackgroundWorkBar: () => null }))
vi.mock('@/components/session/SessionGoalBar', () => ({ SessionGoalBar: () => null }))
vi.mock('@/components/session/FormPrompt', () => ({ FormPrompt: () => null }))
vi.mock('@/components/session/MinimizedFormIndicator', () => ({ MinimizedFormIndicator: () => null }))
vi.mock('@/components/session/SessionPickerDialog', () => ({ SessionPickerDialog: () => null }))
vi.mock('@/components/session/ChangesWalkthroughSheet', () => ({ ChangesWalkthroughSheet: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))
vi.mock('@/components/navigation/SessionMoreButton', () => ({ SessionMoreButton: () => null }))
vi.mock('@/components/navigation/ToolSidePanel', () => ({ ToolSidePanel: () => null }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/source-control', () => ({
  SourceControlPanel: () => null,
  RemoteSourceControlPanel: () => null,
}))
vi.mock('@/components/terminal/TerminalPanel', () => ({ TerminalPanel: () => null }))
vi.mock('@/components/preview/PreviewPanel', () => ({ PreviewPanel: () => null }))
vi.mock('@/components/repo/ProjectActionsMenu', () => ({ ProjectActionsMenu: () => null }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsDialog: () => null }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: () => null }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: () => null }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: () => null }))

const repo = {
  id: 1,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
  defaultBranch: 'main',
  currentBranch: 'main',
  branch: 'main',
  cloneStatus: 'ready',
  clonedAt: 1,
  isWorktree: false,
}

function renderSessionDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/repos/1/sessions/nope']}>
        <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
        <Routes>
          <Route path="/repos/:id" element={null} />
          <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { capturedPathname, capturedSearch }
}

describe('SessionDetail not-found handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRepo.mockResolvedValue(repo)
    mocks.useSessionTranscript.mockReturnValue({
      messages: [],
      pending: [],
      status: 'idle',
      isLoading: false,
      fetchOlder: vi.fn(),
      hasOlder: false,
    })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
    mocks.useRepoActivity.mockReturnValue(undefined)
    mocks.useRepoSiblings.mockReturnValue({ data: [] })
    mocks.usePermissions.mockReturnValue({
      pendingCount: 0,
      hasPermissionsForSession: vi.fn(() => false),
      syncForSession: vi.fn(),
    })
    mocks.useForms.mockReturnValue({
      current: null,
      getForSession: vi.fn(() => null),
      pendingCount: 0,
      hasFormsForSession: vi.fn(() => false),
      reply: vi.fn(),
      cancel: vi.fn(),
      forgetPendingActionsForSession: vi.fn(),
      syncForSession: vi.fn(),
    })
    mocks.useSettings.mockReturnValue({ preferences: { expandToolCalls: false }, updateSettings: vi.fn() })
    mocks.useSettingsDialog.mockReturnValue({ open: vi.fn(), openTab: vi.fn() })
    mocks.useMobile.mockReturnValue(false)
    mocks.useVisualViewport.mockReturnValue({ keyboardHeight: 0 })
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn(), scrollByUser: vi.fn() })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useTerminalDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSessionStatus.mockReturnValue({ setStatus: vi.fn() })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], isLoading: false })
    mocks.useOpenCodeServerStatuses.mockReturnValue({ statusById: {} })
  })

  it('shows the session not-found state for a malformed session id', async () => {
    mocks.useSession.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new FetchError('Expected a string starting with "ses"', 400),
    })

    const { capturedPathname } = renderSessionDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Back to sessions' }))

    expect(capturedPathname.current).toBe('/repos/1')
    expect(mocks.PromptInput).not.toHaveBeenCalled()
  })

  it('shows the session not-found state for a missing session', async () => {
    mocks.useSession.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new FetchError('Session not found', 404),
    })

    renderSessionDetail()

    expect(await screen.findByText('Session not found')).toBeInTheDocument()
  })

  it('renders the session for a loaded session', async () => {
    mocks.useSession.mockReturnValue({
      data: { id: 'nope', projectID: 'prj_1', title: 'Loaded', time: { created: 1, updated: 2 }, location: { directory: '/abs/repos/my-repo' } },
      isLoading: false,
      error: undefined,
    })

    renderSessionDetail()

    expect(await screen.findByTestId('message-thread')).toBeInTheDocument()
  })
})
