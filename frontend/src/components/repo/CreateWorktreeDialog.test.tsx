import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Repo } from '@/api/types'
import { parseProjectTarget } from '@/lib/projectTarget'
import { CreateWorktreeDialog } from './CreateWorktreeDialog'

const mocks = vi.hoisted(() => ({
  createRepo: vi.fn(),
  listBranches: vi.fn(),
  showToastSuccess: vi.fn(),
  showToastInfo: vi.fn(),
  showToastWarning: vi.fn(),
  invalidateRepoGitCaches: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  createRepo: mocks.createRepo,
  listBranches: mocks.listBranches,
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: mocks.showToastSuccess,
    info: mocks.showToastInfo,
    warning: mocks.showToastWarning,
    error: vi.fn(),
  },
}))

vi.mock('@/lib/queryInvalidation', () => ({
  invalidateRepoGitCaches: mocks.invalidateRepoGitCaches,
}))

const repoUrl = 'git@example.com:org/repo.git'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function createWorktreeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 42,
    localPath: 'repos/feature-x',
    fullPath: '/tmp/repos/feature-x',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    ...overrides,
  }
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <CreateWorktreeDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
          repoUrl={repoUrl}
          defaultBaseBranch="main"
        />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

async function submitCreate() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature/x')
  await user.click(screen.getByRole('button', { name: 'Create Worktree' }))
}

describe('CreateWorktreeDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'feature', type: 'local', current: false },
        { name: 'wt-branch', type: 'local', current: false, isWorktree: true },
        { name: 'remotes/origin/feature', type: 'remote', current: false },
        { name: 'remotes/origin/release', type: 'remote', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
    mocks.createRepo.mockResolvedValue(createWorktreeRepo())
  })

  it('lists only non-current, non-worktree local branches and remote-only branches in existing mode', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))

    expect(screen.getByRole('option', { name: 'feature' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /release/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /main/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /wt-branch/ })).not.toBeInTheDocument()
  })

  it('creates a worktree for an existing remote-only branch without a base branch', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))
    await user.click(screen.getByRole('option', { name: /release/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(mocks.createRepo).toHaveBeenCalledTimes(1))
    expect(mocks.createRepo).toHaveBeenCalledWith({ repoUrl, branch: 'release', useWorktree: true })
    expect(mocks.createRepo.mock.calls[0][0]).not.toHaveProperty('baseBranch')
  })

  it('does not offer remote-only branches from non-origin remotes', async () => {
    mocks.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'remotes/upstream/release', type: 'remote', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))

    expect(screen.queryByRole('option', { name: /release/ })).not.toBeInTheDocument()
  })

  it('deduplicates remote candidates that share a short name across remotes', async () => {
    mocks.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'remotes/origin/release', type: 'remote', current: false },
        { name: 'remotes/upstream/release', type: 'remote', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))

    expect(screen.getAllByRole('option', { name: /release/ })).toHaveLength(1)
  })

  it('creates a worktree for a new branch with the selected base branch', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'my-new-branch')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /main/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(mocks.createRepo).toHaveBeenCalledTimes(1))
    expect(mocks.createRepo).toHaveBeenCalledWith({
      repoUrl,
      branch: 'my-new-branch',
      useWorktree: true,
      baseBranch: 'main',
    })
  })

  it('submits a remote-only base branch qualified with origin', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'my-new-branch')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /release/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(mocks.createRepo).toHaveBeenCalledTimes(1))
    expect(mocks.createRepo).toHaveBeenCalledWith({
      repoUrl,
      branch: 'my-new-branch',
      useWorktree: true,
      baseBranch: 'origin/release',
    })
  })

  it('prompts to use existing mode when a new branch name already exists', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature')

    expect(await screen.findByText('Use Existing branch instead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
  })

  it('opens the setup terminal in the hub when the worktree setup starts', async () => {
    mocks.createRepo.mockResolvedValue(
      createWorktreeRepo({
        worktreeSetup: {
          status: 'started',
          terminal: {
            id: 'pty-1',
            title: 'Worktree setup',
            kind: 'setup',
            cwd: '/tmp/repos/feature-x',
            status: 'running',
          },
          repoCommandsSkipped: false,
        },
      }),
    )

    renderDialog()
    await submitCreate()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('dialog=terminal'))

    const locationText = screen.getByTestId('location').textContent ?? ''
    const [pathname, search = ''] = locationText.split('?')
    const params = new URLSearchParams(search)
    expect(pathname).toBe('/')
    expect(params.get('menu')).toBe('sessions')
    expect(parseProjectTarget(params.get('menuProject'))).toEqual({ kind: 'repo', repoId: 42 })
    expect(parseProjectTarget(params.get('toolProject'))).toEqual({ kind: 'repo', repoId: 42 })
    expect(params.get('dialog')).toBe('terminal')
    expect(params.get('terminal')).toBe('pty-1')
  })

  it('warns without navigating when the worktree setup fails', async () => {
    mocks.createRepo.mockResolvedValue(
      createWorktreeRepo({ worktreeSetup: { status: 'failed', error: 'spawn failed' } }),
    )

    renderDialog()
    await submitCreate()

    await waitFor(() => expect(mocks.showToastWarning).toHaveBeenCalled())
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('informs about skipped repository commands when the setup is skipped', async () => {
    mocks.createRepo.mockResolvedValue(
      createWorktreeRepo({ worktreeSetup: { status: 'skipped', reason: 'untrusted' } }),
    )

    renderDialog()
    await submitCreate()

    await waitFor(() =>
      expect(mocks.showToastInfo).toHaveBeenCalledWith(
        'Repository setup commands were skipped until trusted in Actions',
      ),
    )
    expect(screen.getByTestId('location').textContent).toBe('/')
  })
})
