import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MoreDrawer } from './MoreDrawer'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { getRepo } from '@/api/repos'
import type { ActiveWorkItem } from '@/lib/activeWork'
import type { UnreadScheduleRun } from '@/api/schedules'

vi.mock('@/hooks/useAuth')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/api/repos', () => ({
  getRepo: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(),
  }
})

const activityMocks = vi.hoisted(() => ({
  useActiveWork: vi.fn(),
  useActivityWindowMinutes: vi.fn(),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: activityMocks.useActiveWork,
  useActivityWindowMinutes: activityMocks.useActivityWindowMinutes,
  useRepoActivityState: () => null,
}))

const scheduleMocks = vi.hoisted(() => ({
  useUnreadScheduleRuns: vi.fn(),
  useMarkAllScheduleRunsViewed: vi.fn(),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useUnreadScheduleRuns: scheduleMocks.useUnreadScheduleRuns,
  useMarkAllScheduleRunsViewed: scheduleMocks.useMarkAllScheduleRunsViewed,
}))

function createActiveWorkItem(): ActiveWorkItem {
  const now = Date.now()
  return {
    key: '1:s1',
    state: 'recent',
    updatedAt: now,
    path: '/repos/1/sessions/s1',
    session: {
      id: 's1',
      projectID: 'proj-1',
      title: 'Session s1',
      time: { created: now - 10_000, updated: now },
      location: { directory: '/path/to/repo1' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    repo: {
      id: 1,
      name: 'repo1',
      fullPath: '/path/to/repo1',
      localPath: '/path/to/repo1',
      defaultBranch: 'main',
      currentBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
    },
  }
}

function createUnreadScheduleRun(): UnreadScheduleRun {
  const now = Date.now()
  return {
    id: 1,
    jobId: 1,
    repoId: 1,
    triggerSource: 'schedule',
    status: 'completed',
    startedAt: now - 60000,
    finishedAt: now - 30000,
    viewedAt: null,
    createdAt: now - 60000,
    sessionId: null,
    sessionTitle: null,
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: null,
    commitHash: null,
    worktreePath: null,
    jobName: 'Nightly report',
    repoName: 'repo1',
    repoPath: '/path/to/repo1',
    preview: 'Report ready',
  }
}

function setActivityGroups(groups: {
  needsInput?: ActiveWorkItem[]
  running?: ActiveWorkItem[]
  recent?: ActiveWorkItem[]
}) {
  activityMocks.useActiveWork.mockReturnValue({
    groups: {
      needsInput: groups.needsInput ?? [],
      running: groups.running ?? [],
      recent: groups.recent ?? [],
    },
    isLoading: false,
    isError: false,
  })
}

const mockAuth = (logout = vi.fn()) => {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    config: null,
    signInWithEmail: vi.fn(),
    signInWithProvider: vi.fn(),
    signInWithPasskey: vi.fn(),
    signUpWithEmail: vi.fn(),
    addPasskey: vi.fn(),
    logout,
    refreshSession: vi.fn(),
  })
}

const mockServerHealth = (health?: Partial<ReturnType<typeof useServerHealth>['data']>) => {
  const baseHealth = {
    status: 'healthy' as const,
    timestamp: new Date().toISOString(),
    database: 'connected' as const,
    opencode: 'healthy' as const,
    opencodePort: 5551,
    opencodeVersion: null,
    opencodeMinVersion: '1.0.0',
    opencodeManagerVersion: null,
    error: undefined,
  }

  vi.mocked(useServerHealth).mockReturnValue({
    data: {
      ...baseHealth,
      ...health,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
}

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderMoreDrawer = ({
  initialEntry = '/',
  routePath = '*',
  onClose = vi.fn(),
}: {
  initialEntry?: string
  routePath?: string
  onClose?: () => void
} = {}) => render(
  <QueryClientProvider client={createQueryClient()}>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePath} element={<MoreDrawer isOpen onClose={onClose} />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

describe('MoreDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(getRepo).mockResolvedValue({
      id: 1,
      localPath: 'wrong-repo',
      fullPath: '/workspace/repos/wrong-repo',
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
    })
    activityMocks.useActivityWindowMinutes.mockReturnValue(30)
    setActivityGroups({})
    scheduleMocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 0, failed: 0 } })
    scheduleMocks.useMarkAllScheduleRunsViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('renders Settings and Logout menu items', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('does not render theme controls', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByText('Light')).not.toBeInTheDocument()
    expect(screen.queryByText('Dark')).not.toBeInTheDocument()
    expect(screen.queryByText('System')).not.toBeInTheDocument()
  })

  it('navigates to settings URL when Settings is clicked', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Settings'))
    expect(navigateMock).toHaveBeenCalledWith(
      { search: 'settings=open&settingsTab=account' },
      { replace: true },
    )
  })

  it('calls logout when Logout is clicked', () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined)
    mockAuth(logoutMock)
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Logout'))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('displays OpenCode and Manager versions when available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: '1.4.11', opencodeManagerVersion: '0.9.16' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11 · Manager v0.9.16')).toBeInTheDocument()
  })

  it('shows unhealthy server status when server is unhealthy', () => {
    mockAuth()
    mockServerHealth({ opencode: 'unhealthy' as const, opencodeVersion: '1.4.11' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11')).toBeInTheDocument()
  })

  it('shows fallback text when version is not available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: null, opencodeManagerVersion: null })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
  })

  it('leaves commands and file mentions to the prompt input', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.queryByText('Commands')).not.toBeInTheDocument()
    expect(screen.queryByText('Mention File')).not.toBeInTheDocument()
  })

  it('groups session items into workspace and project sections', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    const sectionLabels = (name: string) =>
      within(screen.getByRole('region', { name })).getAllByRole('button').map((button) => button.textContent)

    expect(sectionLabels('Workspace')).toEqual(['Files', 'Source Control', 'Terminal', 'Walkthrough', 'Preview'])
    expect(sectionLabels('Project')).toEqual(['MCP', 'Skills', 'Reset Permissions', 'Schedules', 'Actions'])
    expect(screen.getAllByText('Settings')).toHaveLength(1)
    expect(screen.getAllByText('Logout')).toHaveLength(1)
  })

  it('shows Assistant instead of the source repo on assistant routes', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/assistant', routePath: '/repos/:id/assistant', onClose: handleClose })

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('shows Assistant instead of the source repo on canonical /assistant route', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/assistant', routePath: '/assistant', onClose: handleClose })

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('preserves session route as return target when opening schedules', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?assistant=1', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByText('Schedules'))

    expect(navigateMock).toHaveBeenCalledWith('/repos/1/schedules?returnTo=%2Frepos%2F1%2Fsessions%2Fsession-1%3Fassistant%3D1')
  })

  it('swaps the menu for the Repos sheet from a session', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?mobileTab=more', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByText('Repos'))

    expect(navigateMock).toHaveBeenCalledWith({ search: 'mobileTab=repos' }, { replace: false })
  })

  it('keeps Home and hides the Repos row outside a session', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1', routePath: '/repos/:id' })

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.queryByText('Repos')).not.toBeInTheDocument()
  })

  it('offers the Assistant from a repo session', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))

    expect(navigateMock).toHaveBeenCalledWith('/assistant')
  })

  it('does not offer the Assistant from an assistant session', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?assistant=1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it('shows the Activity section above the menu when there are items', () => {
    mockAuth()
    mockServerHealth()
    setActivityGroups({ recent: [createActiveWorkItem()] })
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    const heading = screen.getByRole('heading', { name: 'Activity' })
    const firstMenuRow = screen.getByText('Files')
    expect(screen.getByText('Session s1')).toBeInTheDocument()
    expect(heading.compareDocumentPosition(firstMenuRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the Activity section when there are no items', () => {
    mockAuth()
    mockServerHealth()
    setActivityGroups({})
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument()
    expect(screen.queryByText('Session s1')).not.toBeInTheDocument()
  })

  it('navigates to the activity item without a close that would replace the new route', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    setActivityGroups({ recent: [createActiveWorkItem()] })
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId', onClose: handleClose })

    fireEvent.click(screen.getByRole('button', { name: /Session s1/ }))

    expect(navigateMock).toHaveBeenCalledWith('/repos/1/sessions/s1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('offers only the remote-capable project items on a linked-server route', () => {
    mockAuth()
    mockServerHealth()
    setActivityGroups({ recent: [createActiveWorkItem()] })
    renderMoreDrawer({
      initialEntry: '/servers/srv_kitchen/sessions/ses_remote',
      routePath: '/servers/:serverId/sessions/:sessionId',
    })

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.getByText('Source Control')).toBeInTheDocument()
    expect(screen.queryByText('Preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    expect(screen.queryByText('Reset Permissions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it('shows unread reports and marks them all read', () => {
    const markAllReportsViewed = vi.fn()
    mockAuth()
    mockServerHealth()
    scheduleMocks.useUnreadScheduleRuns.mockReturnValue({
      data: { runs: [createUnreadScheduleRun()], total: 1, failed: 0 },
    })
    scheduleMocks.useMarkAllScheduleRunsViewed.mockReturnValue({ mutate: markAllReportsViewed, isPending: false })
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.getByText('Nightly report')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))

    expect(markAllReportsViewed).toHaveBeenCalledTimes(1)
  })
})
