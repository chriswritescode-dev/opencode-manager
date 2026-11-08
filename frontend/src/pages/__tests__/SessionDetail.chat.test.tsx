import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionDetail } from '../SessionDetail'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useChat: vi.fn(),
  useDeleteChatSession: vi.fn(),
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
  MessageThread: vi.fn(() => <div data-testid="message-thread" />),
  PromptInput: vi.fn(() => null),
  FileBrowserSheet: vi.fn(() => null),
  TerminalPanel: vi.fn(() => null),
  PreviewPanel: vi.fn(() => null),
  ProjectActionsMenu: vi.fn(() => null),
  RepoActionsDialog: vi.fn(() => null),
  ResetPermissionsDialog: vi.fn(() => null),
  RepoSkillsDialog: vi.fn(() => null),
  RepoMcpDialog: vi.fn(() => null),
  SourceControlPanel: vi.fn(() => null),
  RemoteSourceControlPanel: vi.fn(() => null),
  ChangesWalkthroughSheet: vi.fn(() => null),
  ToolSidePanel: vi.fn(() => null),
  SessionMoreButton: vi.fn(() => null),
}))

vi.mock('@/api/repos', () => ({ getRepo: mocks.getRepo }))

vi.mock('@/hooks/useChats', () => ({
  useChat: mocks.useChat,
  useDeleteChatSession: mocks.useDeleteChatSession,
}))

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
vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ bind: vi.fn(), swipeProgress: 0, swipeStyles: {} })),
}))
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
vi.mock('@/components/session/SessionSendErrorBanner', () => ({ SessionSendErrorBanner: () => null }))
vi.mock('@/components/session/BackgroundWorkBar', () => ({ BackgroundWorkBar: () => null }))
vi.mock('@/components/session/SessionGoalBar', () => ({ SessionGoalBar: () => null }))
vi.mock('@/components/session/FormPrompt', () => ({ FormPrompt: () => null }))
vi.mock('@/components/session/MinimizedFormIndicator', () => ({ MinimizedFormIndicator: () => null }))
vi.mock('@/components/session/ChangesWalkthroughSheet', () => ({
  ChangesWalkthroughSheet: mocks.ChangesWalkthroughSheet,
}))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))
vi.mock('@/components/navigation/SessionMoreButton', () => ({ SessionMoreButton: mocks.SessionMoreButton }))
vi.mock('@/components/navigation/ToolSidePanel', () => ({ ToolSidePanel: mocks.ToolSidePanel }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: mocks.FileBrowserSheet }))
vi.mock('@/components/source-control', () => ({
  SourceControlPanel: mocks.SourceControlPanel,
  RemoteSourceControlPanel: mocks.RemoteSourceControlPanel,
}))
vi.mock('@/components/terminal/TerminalPanel', () => ({ TerminalPanel: mocks.TerminalPanel }))
vi.mock('@/components/preview/PreviewPanel', () => ({ PreviewPanel: mocks.PreviewPanel }))
vi.mock('@/components/repo/ProjectActionsMenu', () => ({ ProjectActionsMenu: mocks.ProjectActionsMenu }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsDialog: mocks.RepoActionsDialog }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({
  ResetPermissionsDialog: mocks.ResetPermissionsDialog,
}))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: mocks.RepoSkillsDialog }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: mocks.RepoMcpDialog }))

const chatId = '20260101-120000-abcdef'
const chat = {
  id: chatId,
  directory: `/chats/${chatId}/work`,
  filesPath: `/chats/${chatId}`,
  createdAt: 1,
}

const chatSession = {
  id: 'ses_chat',
  projectID: 'prj_chat',
  title: 'Scratch chat',
  time: { created: 1, updated: 2 },
  location: { directory: chat.directory },
}

function renderChatSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/chats/${chatId}/sessions/ses_chat`]}>
        <Routes>
          <Route path="/" element={null} />
          <Route path="/chats/:chatId/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SessionDetail chat session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useChat.mockReturnValue({ data: chat, isLoading: false, error: undefined })
    mocks.useDeleteChatSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    mocks.useSession.mockReturnValue({ data: chatSession, isLoading: false, error: undefined })
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

  it('renders the transcript and labels the project as a chat', async () => {
    renderChatSession()

    expect(await screen.findByTestId('message-thread')).toBeInTheDocument()
    expect(mocks.PromptInput).toHaveBeenCalled()
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('does not load a Manager repository', async () => {
    renderChatSession()

    await screen.findByTestId('message-thread')

    expect(mocks.getRepo).not.toHaveBeenCalled()
  })

  it('scopes the file browser, terminal, and preview to the chat folder', async () => {
    renderChatSession()

    await screen.findByTestId('message-thread')

    expect(mocks.FileBrowserSheet.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ basePath: chat.filesPath }),
    )
    expect(mocks.TerminalPanel.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        target: { kind: 'chat', chatId },
        directory: chat.directory,
      }),
    )
    expect(mocks.PreviewPanel.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ directory: chat.directory }),
    )
  })

  it('hides repository-only surfaces', async () => {
    renderChatSession()

    await screen.findByTestId('message-thread')

    expect(mocks.ProjectActionsMenu).not.toHaveBeenCalled()
    expect(mocks.RepoActionsDialog).not.toHaveBeenCalled()
    expect(mocks.RepoMcpDialog).not.toHaveBeenCalled()
    expect(mocks.RepoSkillsDialog).not.toHaveBeenCalled()
    expect(mocks.ResetPermissionsDialog).not.toHaveBeenCalled()
    expect(mocks.SourceControlPanel).not.toHaveBeenCalled()
    expect(mocks.RemoteSourceControlPanel).not.toHaveBeenCalled()
    expect(mocks.ChangesWalkthroughSheet).not.toHaveBeenCalled()
  })

  it('shows a chat not-found state for an unknown chat', async () => {
    mocks.useChat.mockReturnValue({ data: null, isLoading: false, error: undefined })

    renderChatSession()

    expect(await screen.findByText('Chat not found')).toBeInTheDocument()
    expect(screen.queryByTestId('message-thread')).not.toBeInTheDocument()
  })

  it('shows the load error instead of not-found when the chat request fails', async () => {
    mocks.useChat.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Chat request failed'),
    })

    renderChatSession()

    expect(await screen.findByText('Chat request failed')).toBeInTheDocument()
    expect(screen.queryByText('Chat not found')).not.toBeInTheDocument()
    expect(screen.queryByTestId('message-thread')).not.toBeInTheDocument()
  })
})
