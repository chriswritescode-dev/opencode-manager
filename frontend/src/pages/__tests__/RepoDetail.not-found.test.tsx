import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FetchError } from '@/api/fetchWrapper'
import { LocationCatcher } from '@/test/test-utils'
import { RepoDetail } from '../RepoDetail'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useRepoSiblings: vi.fn(),
  useCreateRepoWorkspace: vi.fn(),
  useDeleteRepoWorkspaces: vi.fn(),
  useRepoActivity: vi.fn(),
  useSSE: vi.fn(),
  useCreateSession: vi.fn(),
  useMultiRuns: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  workspaceLabel: () => 'worktree',
  worktreeSourceLabel: () => null,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useRepoSiblings', () => ({
  useRepoSiblings: mocks.useRepoSiblings,
  useCreateRepoWorkspace: mocks.useCreateRepoWorkspace,
  useDeleteRepoWorkspaces: mocks.useDeleteRepoWorkspaces,
}))

vi.mock('@/hooks/useRepoActivity', () => ({ useRepoActivity: mocks.useRepoActivity }))
vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWorkCounts: () => ({ needsInput: 0, running: 0 }),
  useRepoActivityState: () => null,
}))
vi.mock('@/hooks/useSSE', () => ({ useSSE: mocks.useSSE }))
vi.mock('@/hooks/useOpenCode', () => ({ useCreateSession: mocks.useCreateSession }))
vi.mock('@/hooks/useMultiRuns', () => ({
  useMultiRuns: mocks.useMultiRuns,
  useLaunchMultiRun: () => ({ mutate: vi.fn(), isPending: false }),
  useFuseMultiRun: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn(), error: null }),
  useDiscardMultiRunEntry: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/session/SessionList', () => ({ SessionList: () => null }))
vi.mock('@/components/repo/WorktreeTabs', () => ({ WorktreeTabs: () => null }))
vi.mock('@/components/terminal/TerminalPanel', () => ({ TerminalPanel: () => null }))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({ FileBrowserSheet: () => null }))
vi.mock('@/components/repo/RepoMcpDialog', () => ({ RepoMcpDialog: () => null }))
vi.mock('@/components/repo/ProjectActionsMenu', () => ({ ProjectActionsMenu: () => null }))
vi.mock('@/components/repo/RepoActionsDialog', () => ({ RepoActionsDialog: () => null }))
vi.mock('@/components/repo/RepoSkillsDialog', () => ({ RepoSkillsDialog: () => null }))
vi.mock('@/components/source-control', () => ({ SourceControlPanel: () => null }))
vi.mock('@/components/preview/PreviewPanel', () => ({ PreviewPanel: () => null }))
vi.mock('@/components/repo/ResetPermissionsDialog', () => ({ ResetPermissionsDialog: () => null }))
vi.mock('@/components/notifications/PendingActionsGroup', () => ({ PendingActionsGroup: () => null }))
vi.mock('@/components/navigation/ToolSidePanel', () => ({ ToolSidePanel: () => null }))

function renderRepoDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
  })
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/repos/999']}>
        <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
        <Routes>
          <Route path="/" element={null} />
          <Route path="/repos/:id" element={<RepoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, capturedPathname, capturedSearch }
}

describe('RepoDetail not-found handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRepoSiblings.mockReturnValue({ data: [] })
    mocks.useCreateRepoWorkspace.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useDeleteRepoWorkspaces.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCreateSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useMultiRuns.mockReturnValue({ data: [] })
  })

  it('shows a not-found state with a way home without retrying the missing repo', async () => {
    mocks.getRepo.mockRejectedValue(new FetchError('Repository not found', 404))

    const { capturedPathname } = renderRepoDetail()

    expect(await screen.findByText('Repository not found')).toBeInTheDocument()
    expect(mocks.getRepo).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Back to repositories' }))

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/')
    })
  })

  it('still retries a transient repository failure', async () => {
    mocks.getRepo.mockRejectedValueOnce(new FetchError('Server error', 500))
    mocks.getRepo.mockRejectedValueOnce(new FetchError('Server error', 500))
    mocks.getRepo.mockResolvedValue({
      id: 999,
      name: 'my-repo',
      localPath: 'repos/my-repo',
      fullPath: '/abs/repos/my-repo',
      defaultBranch: 'main',
      currentBranch: 'main',
      branch: 'main',
      cloneStatus: 'ready',
      clonedAt: 1,
      isWorktree: false,
    })

    renderRepoDetail()

    await waitFor(() => {
      expect(mocks.getRepo).toHaveBeenCalledTimes(3)
    })
  })
})
