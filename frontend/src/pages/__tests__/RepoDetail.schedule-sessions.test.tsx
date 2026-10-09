import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Repo, Session } from '@/api/types'
import type { RepoSibling } from '@/api/repos'
import { RepoDetail } from '../RepoDetail'

interface SessionListCapture {
  directories?: string[]
  renderSessions?: (args: {
    sessions: Session[]
    searchQuery: string
    renderSessionCard: (session: Session) => ReactNode
  }) => ReactNode
}

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useRepoSiblings: vi.fn(),
  useCreateRepoWorkspace: vi.fn(),
  useDeleteRepoWorkspaces: vi.fn(),
  useRepoActivity: vi.fn(),
  useSSE: vi.fn(),
  useCreateSession: vi.fn(),
  useMultiRuns: vi.fn(),
  lastSessionListProps: { current: undefined as SessionListCapture | undefined },
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  workspaceLabel: (workspace: { currentBranch?: string; branch?: string; localPath?: string }) =>
    workspace.currentBranch || workspace.branch || workspace.localPath || 'worktree',
  worktreeSourceLabel: (worktree: { schedule?: { runId: number | null }; worktreeSource?: string }) => {
    if (worktree.schedule) {
      return worktree.schedule.runId === null ? 'Schedule · shared' : `Schedule · run #${worktree.schedule.runId}`
    }
    if (worktree.worktreeSource === 'git') return 'Git'
    return worktree.worktreeSource === 'opencode' ? 'OpenCode' : null
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/useRepoSiblings', () => ({
  useRepoSiblings: mocks.useRepoSiblings,
  useCreateRepoWorkspace: mocks.useCreateRepoWorkspace,
  useDeleteRepoWorkspaces: mocks.useDeleteRepoWorkspaces,
}))

vi.mock('@/hooks/useRepoActivity', () => ({ useRepoActivity: mocks.useRepoActivity }))
vi.mock('@/hooks/useSSE', () => ({ useSSE: mocks.useSSE }))
vi.mock('@/hooks/useOpenCode', () => ({ useCreateSession: mocks.useCreateSession }))
vi.mock('@/hooks/useMultiRuns', () => ({
  useMultiRuns: mocks.useMultiRuns,
  useLaunchMultiRun: () => ({ mutate: vi.fn(), isPending: false }),
  useFuseMultiRun: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn(), error: null }),
  useDiscardMultiRunEntry: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/session/SessionList', () => ({
  SessionList: (props: SessionListCapture) => {
    mocks.lastSessionListProps.current = props
    return (
      <div>
        {props.renderSessions?.({
          sessions: [],
          searchQuery: '',
          renderSessionCard: () => null,
        })}
      </div>
    )
  },
}))

vi.mock('@/components/repo/WorktreeTabs', () => ({
  WorktreeTabs: ({ onValueChange }: { onValueChange: (value: 'workspaces') => void }) => (
    <button type="button" onClick={() => onValueChange('workspaces')}>Worktrees tab</button>
  ),
}))

vi.mock('@/components/terminal/TerminalPanel', () => ({ TerminalPanel: () => null }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: () => null }))
vi.mock('@/components/repo/ProjectActionsMenu', () => ({ ProjectActionsMenu: () => null }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsDialog: () => null }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: () => null }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: () => null }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))

const baseRepo: Repo = {
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

const opencodeWorktree: RepoSibling = {
  ...baseRepo,
  id: 2,
  fullPath: '/abs/repos/my-repo-ws',
  currentBranch: 'feature/x',
  branch: 'feature/x',
  isWorktree: true,
  worktreeSource: 'opencode',
}

const scheduleWorktree: RepoSibling = {
  ...baseRepo,
  id: 3,
  fullPath: '/abs/repos/schedule-nightly',
  currentBranch: 'schedule/5/run-7',
  branch: 'schedule/5/run-7',
  isWorktree: true,
  worktreeSource: 'schedule',
  schedule: { repoId: 1, jobId: 5, runId: 7, inUse: false, name: 'Nightly' },
}

function renderRepoDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/repos/1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RepoDetail schedule session fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lastSessionListProps.current = undefined
    mocks.getRepo.mockResolvedValue(baseRepo)
    mocks.useRepoSiblings.mockReturnValue({ data: [opencodeWorktree, scheduleWorktree] })
    mocks.useCreateRepoWorkspace.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useDeleteRepoWorkspaces.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCreateSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useMultiRuns.mockReturnValue({ data: [] })
  })

  it('fetches a schedule worktree directory only after its group is expanded', async () => {
    const user = userEvent.setup()
    renderRepoDetail()

    await user.click(await screen.findByRole('button', { name: 'Worktrees tab' }))

    await waitFor(() => {
      expect(mocks.lastSessionListProps.current?.directories).toEqual(['/abs/repos/my-repo-ws'])
    })

    await user.click(screen.getByRole('button', { expanded: false, name: /schedule\/5\/run-7/ }))

    await waitFor(() => {
      expect(mocks.lastSessionListProps.current?.directories).toEqual([
        '/abs/repos/my-repo-ws',
        '/abs/repos/schedule-nightly',
      ])
    })
  })
})
