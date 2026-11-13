import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateWorktreeDialog } from './CreateWorktreeDialog'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { installPointerCapture } from '@/test/browserFakes'
import { makeRepo } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { Repo } from '@/api/types'
import type { GitBranch } from '@/api/repos'

const repoUrl = 'git@example.com:org/repo.git'

const defaultBranches: GitBranch[] = [
  { name: 'main', type: 'local', current: true },
  { name: 'feature', type: 'local', current: false },
  { name: 'wt-branch', type: 'local', current: false, isWorktree: true },
  { name: 'remotes/origin/feature', type: 'remote', current: false },
  { name: 'remotes/origin/release', type: 'remote', current: false },
]

function createWorktreeRepo(overrides: Partial<Repo> = {}): Repo {
  return makeRepo({
    id: 42,
    name: 'feature-x',
    localPath: 'repos/feature-x',
    fullPath: '/tmp/repos/feature-x',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    isWorktree: true,
    ...overrides,
  })
}

function branchesRoute(branches: GitBranch[]): FetchRoute {
  return {
    method: 'GET',
    path: '/api/repos/1/git/branches',
    respond: () => ({ json: { branches, status: { ahead: 0, behind: 0 } } }),
  }
}

function createRoute(repo: Repo = createWorktreeRepo()): FetchRoute {
  return { method: 'POST', path: '/api/repos', respond: () => ({ json: repo }) }
}

function renderDialog(options: { branches?: GitBranch[]; createdRepo?: Repo; extraRoutes?: FetchRoute[] } = {}) {
  installPointerCapture()
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const view = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <CreateWorktreeDialog open onOpenChange={() => undefined} repoId={1} repoUrl={repoUrl} defaultBaseBranch="main" />
    </>,
    {
      auth: false,
      theme: false,
      fetchRoutes: [branchesRoute(options.branches ?? defaultBranches), createRoute(options.createdRepo), ...(options.extraRoutes ?? [])],
    },
  )
  return { ...view, capturedPathname, capturedSearch }
}

async function submitCreate() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature/x')
  await user.click(screen.getByRole('button', { name: 'Create Worktree' }))
  return user
}

describe('CreateWorktreeDialog', () => {
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
    const { fetchFake } = renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))
    await user.click(screen.getByRole('option', { name: /release/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/repos')?.body).toEqual({
      repoUrl,
      branch: 'release',
      useWorktree: true,
    }))
  })

  it('does not offer remote-only branches from non-origin remotes', async () => {
    const user = userEvent.setup()
    renderDialog({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'remotes/upstream/release', type: 'remote', current: false },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))

    expect(screen.queryByRole('option', { name: /release/ })).not.toBeInTheDocument()
  })

  it('deduplicates remote candidates that share a short name across remotes', async () => {
    const user = userEvent.setup()
    renderDialog({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'remotes/origin/release', type: 'remote', current: false },
        { name: 'remotes/upstream/release', type: 'remote', current: false },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Existing branch' }))
    await user.click(screen.getByRole('combobox', { name: 'Branch to check out' }))

    expect(screen.getAllByRole('option', { name: /release/ })).toHaveLength(1)
  })

  it('creates a worktree for a new branch with the selected base branch', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'my-new-branch')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /main/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/repos')?.body).toEqual({
      repoUrl,
      branch: 'my-new-branch',
      useWorktree: true,
      baseBranch: 'main',
    }))
  })

  it('submits a remote-only base branch qualified with origin', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'my-new-branch')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /release/ }))
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/repos')?.body).toEqual({
      repoUrl,
      branch: 'my-new-branch',
      useWorktree: true,
      baseBranch: 'origin/release',
    }))
  })

  it('prompts to use existing mode when a new branch name already exists', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature')

    expect(await screen.findByText('Use Existing branch instead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
  })

  it('navigates to the setup terminal when the worktree setup starts', async () => {
    const { capturedPathname, capturedSearch } = renderDialog({
      createdRepo: createWorktreeRepo({
        worktreeSetup: {
          status: 'started',
          terminal: { id: 'pty-1', title: 'Worktree setup', kind: 'setup', cwd: '/tmp/repos/feature-x', status: 'running' },
          repoCommandsSkipped: false,
        },
      }),
    })

    await submitCreate()

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/42'))
    expect(capturedSearch.current).toBe('?dialog=terminal&terminal=pty-1')
  })

  it('warns without navigating when the worktree setup fails', async () => {
    const { capturedPathname } = renderDialog({
      createdRepo: createWorktreeRepo({ worktreeSetup: { status: 'failed', error: 'spawn failed' } }),
    })

    await submitCreate()

    expect(await screen.findByText('Worktree setup failed to start')).toBeInTheDocument()
    expect(capturedPathname.current).toBe('/')
  })

  it('informs about skipped repository commands when the setup is skipped', async () => {
    const { capturedPathname } = renderDialog({
      createdRepo: createWorktreeRepo({ worktreeSetup: { status: 'skipped', reason: 'untrusted' } }),
    })

    await submitCreate()

    expect(await screen.findByText('Repository setup commands were skipped until trusted in Actions')).toBeInTheDocument()
    expect(capturedPathname.current).toBe('/')
  })
})
