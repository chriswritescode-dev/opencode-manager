import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FetchError } from '@/api/fetchWrapper'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'
import { getServerProjectPath } from '@/lib/navigation'
import { LocationCatcher } from '@/test/test-utils'
import { MessageThread } from '@/components/message/MessageThread'
import { SessionCostIndicator } from '@/components/session/SessionCostIndicator'
import { SessionSendErrorBanner } from '@/components/session/SessionSendErrorBanner'
import { PendingActionsGroup } from '@/components/notifications/PendingActionsGroup'
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
  SourceControlPanel: vi.fn(() => null),
  RemoteSourceControlPanel: vi.fn(() => null),
  TerminalPanel: vi.fn(() => null),
  PreviewPanel: vi.fn(() => null),
  FileBrowserSheet: vi.fn(() => null),
  ProjectActionsMenu: vi.fn(() => null),
  RepoActionsDialog: vi.fn(() => null),
  ResetPermissionsDialog: vi.fn(() => null),
  RepoSkillsDialog: vi.fn(() => null),
  RepoMcpDialog: vi.fn(() => null),
  ChangesWalkthroughSheet: vi.fn(() => null),
  ToolSidePanel: vi.fn(() => null),
  SessionGoalBar: vi.fn(() => null),
  SessionPickerDialog: vi.fn(() => null),
  SessionMoreButton: vi.fn(() => null),
}))

vi.mock('@/api/repos', () => ({ getRepo: mocks.getRepo }))

vi.mock('@/hooks/useOpenCode', () => ({
  useSession: mocks.useSession,
  useInterruptSession: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateSession: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
  useCreateSession: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))

vi.mock('@/hooks/useSessionTranscript', () => ({
  useSessionTranscript: mocks.useSessionTranscript,
}))

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

vi.mock('@/hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({ isEnabled: false })),
}))

vi.mock('@/hooks/useSettings', () => ({ useSettings: mocks.useSettings }))
vi.mock('@/hooks/useSettingsDialog', () => ({ useSettingsDialog: mocks.useSettingsDialog }))
vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ ref: vi.fn() })),
}))
vi.mock('@/hooks/useVisualViewport', () => ({ useVisualViewport: mocks.useVisualViewport }))
vi.mock('@/contexts/KeyboardShortcutsContext', () => ({ useShortcutActions: mocks.useShortcutActions }))
vi.mock('@/hooks/useAutoScroll', () => ({ useAutoScroll: mocks.useAutoScroll }))

vi.mock('@/hooks/useDialogParam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDialogParam')>()
  return { ...actual, useDialogParam: mocks.useDialogParam }
})

vi.mock('@/hooks/useOpenTerminal', () => ({
  useTerminalDialogParam: mocks.useTerminalDialogParam,
}))

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
  return {
    ...actual,
    usePermissions: mocks.usePermissions,
    useForms: mocks.useForms,
  }
})

vi.mock('@/components/message/MessageThread', () => ({
  MessageThread: vi.fn(() => <div data-testid="message-thread" />),
}))
vi.mock('@/components/message/PromptInput', () => ({ PromptInput: vi.fn(() => null) }))
vi.mock('@/components/message/FloatingTTSButton', () => ({ FloatingTTSButton: vi.fn(() => null) }))
vi.mock('@/components/message/MessageSkeleton', () => ({ MessageSkeleton: vi.fn(() => null) }))
vi.mock('@/components/session/SessionCostIndicator', () => ({ SessionCostIndicator: vi.fn(() => null) }))
vi.mock('@/components/session/SessionSendErrorBanner', () => ({ SessionSendErrorBanner: vi.fn(() => null) }))
vi.mock('@/components/session/BackgroundWorkBar', () => ({ BackgroundWorkBar: vi.fn(() => null) }))
vi.mock('@/components/session/SessionGoalBar', () => ({ SessionGoalBar: mocks.SessionGoalBar }))
vi.mock('@/components/session/FormPrompt', () => ({ FormPrompt: vi.fn(() => null) }))
vi.mock('@/components/session/MinimizedFormIndicator', () => ({ MinimizedFormIndicator: vi.fn(() => null) }))
vi.mock('@/components/session/SessionPickerDialog', () => ({ SessionPickerDialog: mocks.SessionPickerDialog }))
vi.mock('@/components/session/ChangesWalkthroughSheet', () => ({
  ChangesWalkthroughSheet: mocks.ChangesWalkthroughSheet,
}))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: vi.fn(() => null),
}))
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

const server = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const remoteSession = {
  id: 'ses_remote',
  projectID: 'prj_1',
  title: 'Remote chat',
  time: { created: 1, updated: 2 },
  location: { directory: '/home/me/app' },
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

type SwipeNavigation = ReturnType<typeof useSwipeNavigation>

function SwipeNavigationProbe({ captured }: { captured: { current: SwipeNavigation } }) {
  captured.current = useSwipeNavigation()
  return null
}

function renderRemoteSession(sessionId = 'ses_remote') {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const capturedSwipeNavigation = { current: null as SwipeNavigation }
  const rendered = render(
    <OpenCodeServerProvider serverId="srv_kitchen">
      <SwipeNavigationProvider>
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter initialEntries={[`/servers/srv_kitchen/sessions/${sessionId}`]}>
            <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
            <SwipeNavigationProbe captured={capturedSwipeNavigation} />
            <Routes>
              <Route path="/" element={null} />
              <Route path="/servers/:serverId/projects" element={null} />
              <Route path="/servers/:serverId/sessions/:sessionId" element={<SessionDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SwipeNavigationProvider>
    </OpenCodeServerProvider>,
  )

  return { ...rendered, capturedPathname, capturedSearch, capturedSwipeNavigation }
}

describe('SessionDetail remote server mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSession.mockReturnValue({ data: remoteSession, isLoading: false, error: undefined })
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
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      updateSettings: vi.fn(),
    })
    mocks.useSettingsDialog.mockReturnValue({ open: vi.fn(), openTab: vi.fn() })
    mocks.useMobile.mockReturnValue(false)
    mocks.useVisualViewport.mockReturnValue({ keyboardHeight: 0 })
    mocks.useAutoScroll.mockReturnValue({ scrollToBottom: vi.fn(), scrollByUser: vi.fn() })
    mocks.useDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useTerminalDialogParam.mockReturnValue([false, vi.fn()])
    mocks.useSessionStatus.mockReturnValue({ setStatus: vi.fn() })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [server], isLoading: false })
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statusById: {
        [server.id]: { serverId: server.id, connected: true, version: null, error: null },
      },
    })
  })

  it('does not load the Manager repo for a remote session', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.getRepo).not.toHaveBeenCalled()
    expect(mocks.useRepoActivity).toHaveBeenLastCalledWith(0, false)
    expect(mocks.useRepoSiblings).toHaveBeenCalledWith(undefined)
  })

  it('shows the remote project in the header without the server name', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByLabelText('Remote server')).toBeInTheDocument()
    })
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.queryByText(/Kitchen/)).not.toBeInTheDocument()
  })

  it('returns to the project page from the header back button', async () => {
    const { capturedPathname, capturedSearch } = renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByLabelText('Remote server')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))

    expect(capturedPathname.current).toBe('/servers/srv_kitchen/projects')
    expect(capturedSearch.current).toBe('?directory=%2Fhome%2Fme%2Fapp')
  })

  it('registers the remote project page as the swipe-back target once the directory resolves', async () => {
    const { capturedSwipeNavigation, unmount } = renderRemoteSession()

    await waitFor(() => {
      expect(capturedSwipeNavigation.current?.backTarget()).toBe(
        getServerProjectPath('srv_kitchen', '/home/me/app'),
      )
    })

    unmount()

    expect(capturedSwipeNavigation.current?.backTarget()).toBeNull()
  })

  it('falls back to the projects list when the session is not found', async () => {
    mocks.useSession.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new FetchError('Session not found', 404),
    })

    const { capturedPathname } = renderRemoteSession()

    fireEvent.click(await screen.findByRole('button', { name: 'Back to projects' }))

    expect(capturedPathname.current).toBe('/')
  })

  it('uses the session directory as the only directory source', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(mocks.useSSE).toHaveBeenLastCalledWith('/home/me/app', 'ses_remote')
    })
    expect(mocks.useSessionTranscript).toHaveBeenLastCalledWith('ses_remote', '/home/me/app')
  })

  it('hides Manager-only panels and actions while keeping the remote-capable tools', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.SourceControlPanel).not.toHaveBeenCalled()
    expect(mocks.PreviewPanel).not.toHaveBeenCalled()
    expect(mocks.FileBrowserSheet).not.toHaveBeenCalled()
    expect(mocks.ProjectActionsMenu).not.toHaveBeenCalled()
    expect(mocks.RepoActionsDialog).not.toHaveBeenCalled()
    expect(mocks.ResetPermissionsDialog).not.toHaveBeenCalled()
    expect(mocks.ChangesWalkthroughSheet).not.toHaveBeenCalled()
    expect(mocks.SessionMoreButton).toHaveBeenCalled()
    expect(vi.mocked(PendingActionsGroup).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ showScheduleReports: false }),
    )
  })

  it('renders the More button so the drawer stays reachable on a remote session', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.SessionMoreButton).toHaveBeenCalled()
  })

  it('shows the session goal bar for a remote session', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.SessionGoalBar).toHaveBeenCalled()
    expect(mocks.SessionGoalBar.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sessionID: 'ses_remote' }),
    )
  })

  it('exposes terminals for the linked server', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.TerminalPanel.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        target: { kind: 'server', serverId: 'srv_kitchen' },
        directory: '/home/me/app',
        isOpen: false,
      }),
    )
    expect(mocks.ToolSidePanel.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        repoId: undefined,
        terminalTarget: { kind: 'server', serverId: 'srv_kitchen' },
        directory: '/home/me/app',
      }),
    )
  })

  it('offers the MCP and skills views scoped to the remote session directory', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(vi.mocked(mocks.RepoMcpDialog).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ directory: '/home/me/app' }),
    )
    expect(vi.mocked(mocks.RepoSkillsDialog).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sessionId: 'ses_remote', directory: '/home/me/app' }),
    )
    expect(vi.mocked(mocks.ToolSidePanel).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ repoDirectory: '/home/me/app', sessionId: 'ses_remote' }),
    )
  })

  it('opens the remote source control panel instead of the Manager one', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(mocks.SourceControlPanel).not.toHaveBeenCalled()
    expect(mocks.RemoteSourceControlPanel.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        serverId: 'srv_kitchen',
        directory: '/home/me/app',
        isOpen: false,
      }),
    )
  })

  it('treats the stream as disconnected when the remote server status is disconnected', async () => {
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statusById: {
        [server.id]: { serverId: server.id, connected: false, version: null, error: null },
      },
    })

    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(vi.mocked(SessionSendErrorBanner).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ isConnected: false, isReconnecting: true }),
    )
  })

  it('passes the remote session to the cost indicator', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(vi.mocked(SessionCostIndicator).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sessionID: 'ses_remote' }),
    )
  })

  it('treats the stream as connected when both the Manager stream and remote server are connected', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(vi.mocked(SessionSendErrorBanner).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ isConnected: true, isReconnecting: false }),
    )
  })

  it('treats the stream as disconnected when the Manager stream drops even if the remote server is connected', async () => {
    mocks.useSSE.mockReturnValue({ isConnected: false, isReconnecting: true })

    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    expect(vi.mocked(SessionSendErrorBanner).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ isConnected: false, isReconnecting: true }),
    )
  })

  it('navigates to the parent session from the header pill', async () => {
    mocks.useSession.mockReturnValue({
      data: { ...remoteSession, parentID: 'ses_parent' },
      isLoading: false,
      error: undefined,
    })

    const { capturedPathname } = renderRemoteSession()

    fireEvent.click(await screen.findByRole('button', { name: 'Parent session' }))

    expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_parent')
  })

  it('opens the session details sheet from the header title', async () => {
    renderRemoteSession()

    fireEvent.click(await screen.findByRole('button', { name: 'Session details: Remote chat' }))

    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Session details')
    expect(screen.getByText('/home/me/app')).toBeInTheDocument()
  })

  it('navigates child sessions within the linked server route', async () => {
    const { capturedPathname } = renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    const threadProps = vi.mocked(MessageThread).mock.calls.at(-1)?.[0]
    expect(threadProps?.onFileClick).toBeUndefined()
    expect(threadProps?.onOpenWalkthrough).toBeUndefined()

    act(() => {
      threadProps?.onChildSessionClick?.('ses_child')
    })

    expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_child')
  })

  it('renders the session picker scoped to the linked server', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    const pickerProps = mocks.SessionPickerDialog.mock.calls.at(-1)?.[0]
    expect(pickerProps).toEqual(
      expect.objectContaining({
        open: false,
        currentRepo: undefined,
        activeSessionID: 'ses_remote',
        remote: {
          serverId: 'srv_kitchen',
          serverName: 'Kitchen',
          projectDirectory: '/home/me/app',
          isPending: false,
        },
      }),
    )
  })

  it('opens the session picker from the sessions shortcut on a remote route', async () => {
    renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    const actions = mocks.useShortcutActions.mock.calls.at(-1)?.[0]
    act(() => {
      actions?.sessions?.()
    })

    await waitFor(() => {
      expect(mocks.SessionPickerDialog.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ open: true, remote: expect.objectContaining({ serverId: 'srv_kitchen' }) }),
      )
    })
  })

  it('navigates to a session chosen from the remote picker', async () => {
    const { capturedPathname } = renderRemoteSession()

    await waitFor(() => {
      expect(screen.getByTestId('message-thread')).toBeInTheDocument()
    })

    const pickerProps = mocks.SessionPickerDialog.mock.calls.at(-1)?.[0]
    act(() => {
      pickerProps?.onSelectRemoteSession?.({ ...remoteSession, id: 'ses_other' }, 'srv_kitchen')
    })

    expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_other')
  })

  it('shows a loader until the session directory is available', async () => {
    mocks.useSession.mockReturnValue({ data: undefined, isLoading: true, error: undefined })

    renderRemoteSession()

    expect(screen.getByText('Loading session...')).toBeInTheDocument()
    expect(mocks.getRepo).not.toHaveBeenCalled()
  })
})
