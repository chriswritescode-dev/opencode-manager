import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Repo } from '@/api/types'
import { RepoDetail } from '../RepoDetail'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useRepoSiblings: vi.fn(),
  useCreateRepoWorkspace: vi.fn(),
  useDeleteRepoWorkspaces: vi.fn(),
  useRepoActivity: vi.fn(),
  useSSE: vi.fn(),
  useCreateSession: vi.fn(),
  createWorkspaceMutate: vi.fn(),
  createWorkspaceResult: vi.fn(),
  showToastInfo: vi.fn(),
  showToastWarning: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  workspaceLabel: (workspace: { currentBranch?: string; branch?: string; localPath?: string }) =>
    workspace.currentBranch || workspace.branch || workspace.localPath || 'workspace',
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    info: mocks.showToastInfo,
    warning: mocks.showToastWarning,
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

vi.mock('@/components/repo/WorktreeTabs', () => ({
  WorktreeTabs: ({ onCreateWorkspace }: { onCreateWorkspace: () => void }) => (
    <button type="button" onClick={onCreateWorkspace}>New workspace</button>
  ),
}))

vi.mock('@/components/terminal/TerminalPanel', () => ({
  TerminalPanel: ({ directory, isOpen }: { directory?: string; isOpen: boolean }) => (
    <div data-testid="terminal-panel" data-directory={directory ?? ''} data-open={String(isOpen)} />
  ),
  TerminalWorkspace: ({ directory }: { directory?: string }) => (
    <div data-testid="terminal-workspace" data-directory={directory ?? ''} />
  ),
}))

vi.mock('@/components/session/SessionList', () => ({ SessionList: () => null }))
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

const newWorkspaceDirectory = '/abs/repos/my-repo-ws'
const siblingsData: Repo[] = []

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderRepoDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/repos/1']}>
        <LocationProbe />
        <Routes>
          <Route path="/repos/:id" element={<RepoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function startWorkspaceCreation() {
  const user = userEvent.setup()
  renderRepoDetail()
  await user.click(await screen.findByRole('button', { name: 'New workspace' }))
  await user.click(await screen.findByRole('button', { name: 'Create Worktree' }))
}

describe('RepoDetail worktree setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceMutate.mockImplementation((_request: unknown, options: { onSuccess: (value: unknown) => void }) => {
      options.onSuccess(mocks.createWorkspaceResult())
    })
    mocks.getRepo.mockResolvedValue(baseRepo)
    mocks.useRepoSiblings.mockReturnValue({ data: siblingsData })
    mocks.useDeleteRepoWorkspaces.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCreateSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  it('switches to the new workspace terminal when setup starts from the repo tab', async () => {
    mocks.useCreateRepoWorkspace.mockReturnValue({
      mutate: mocks.createWorkspaceMutate,
      isPending: false,
    })
    mocks.createWorkspaceResult.mockReturnValue({
      directory: newWorkspaceDirectory,
      worktreeSetup: {
        status: 'started',
        terminal: {
          id: 'pty-new',
          title: 'Worktree setup',
          kind: 'setup',
          cwd: newWorkspaceDirectory,
          status: 'running',
        },
        repoCommandsSkipped: false,
      },
    })

    await startWorkspaceCreation()

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('repoTab=workspaces'),
    )
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('panel=terminal')
    expect(location).toContain('terminal=pty-new')
    expect(await screen.findByTestId('terminal-workspace')).toHaveAttribute(
      'data-directory',
      newWorkspaceDirectory,
    )
  })

  it('stays on the workspace tab without a terminal when setup does not start', async () => {
    mocks.useCreateRepoWorkspace.mockReturnValue({
      mutate: mocks.createWorkspaceMutate,
      isPending: false,
    })
    mocks.createWorkspaceResult.mockReturnValue({
      directory: newWorkspaceDirectory,
      worktreeSetup: { status: 'none' },
    })

    await startWorkspaceCreation()

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('repoTab=workspaces'),
    )
    expect(screen.getByTestId('location')).not.toHaveTextContent('terminal')
    expect(screen.queryByTestId('terminal-workspace')).not.toBeInTheDocument()
    expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-open', 'false')
  })

  it('sends the typed worktree name and blocks names that are not a single folder', async () => {
    mocks.useCreateRepoWorkspace.mockReturnValue({ mutate: mocks.createWorkspaceMutate, isPending: false })
    mocks.createWorkspaceResult.mockReturnValue({ directory: newWorkspaceDirectory, worktreeSetup: { status: 'none' } })
    const user = userEvent.setup()
    renderRepoDetail()

    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    const nameInput = await screen.findByLabelText('Name')
    await user.type(nameInput, '../escape')
    expect(screen.getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
    expect(screen.getByText('Directory name cannot contain dot-dot path segments')).toBeInTheDocument()

    await user.clear(nameInput)
    await user.type(nameInput, 'feature-login')
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    expect(mocks.createWorkspaceMutate).toHaveBeenCalledWith({ name: 'feature-login' }, expect.anything())
  })
})
