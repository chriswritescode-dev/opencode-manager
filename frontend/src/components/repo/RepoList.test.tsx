import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { createUseSettingsMock } from '@/test/test-utils'
import { RepoList } from './RepoList'
import type { Repo } from '@/api/types'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  useRepoActivityState: vi.fn(),
  fetchReposGitStatus: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
  deleteRepo: vi.fn(),
  updateRepoOrder: vi.fn(),
}))

vi.mock('@/api/git', () => ({
  fetchReposGitStatus: mocks.fetchReposGitStatus,
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useRepoActivityState: mocks.useRepoActivityState,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => createUseSettingsMock(),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: () => false,
  useSwipeBack: () => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'demo-app',
    localPath: 'demo-app',
    fullPath: '/workspace/repos/demo-app',
    defaultBranch: 'main',
    branch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isWorktree: false,
    isLocal: true,
    ...overrides,
  }
}

function renderRepoList(
  onAddRepo: () => void = vi.fn(),
  options: { queryClient?: QueryClient } = {},
) {
  const queryClient = options.queryClient
    ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RepoList onAddRepo={onAddRepo} />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

async function openRepoDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Unlink Repository|Delete Repository/ }))
  return screen.findByRole('dialog')
}

describe('RepoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRepoActivityState.mockReturnValue(null)
    mocks.fetchReposGitStatus.mockResolvedValue(new Map())
  })

  it('calls onAddRepo once from the empty state', async () => {
    mocks.listRepos.mockResolvedValue([])
    const onAddRepo = vi.fn()
    const user = userEvent.setup()

    renderRepoList(onAddRepo)

    await user.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(onAddRepo).toHaveBeenCalledTimes(1)
  })

  it('shows a search-aware empty message when nothing matches the query', async () => {
    mocks.listRepos.mockResolvedValue([createRepo()])
    const user = userEvent.setup()

    renderRepoList()

    await screen.findByText('demo-app')
    await user.type(screen.getByPlaceholderText('Search repositories...'), 'zzzz-nomatch')

    expect(await screen.findByText('No repositories found matching "zzzz-nomatch"')).toBeInTheDocument()
    expect(screen.queryByText('No recently accessed repositories')).not.toBeInTheDocument()
  })

  it('keeps the filter empty message when no search query is active', async () => {
    mocks.listRepos.mockResolvedValue([createRepo({ cloneStatus: 'cloning' })])

    renderRepoList()

    expect(await screen.findByText('No recently accessed repositories')).toBeInTheDocument()
  })

  it('shows the error state when the first load fails', async () => {
    mocks.listRepos.mockRejectedValue(new Error('offline'))

    renderRepoList()

    expect(await screen.findByText(/Failed to load repositories/)).toBeInTheDocument()
  })

  it('keeps cached repositories when the refetch fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['repos'], [createRepo()])
    mocks.listRepos.mockRejectedValue(new Error('offline'))

    renderRepoList(vi.fn(), { queryClient })

    expect(await screen.findByText('demo-app')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(['repos'])?.status).toBe('error'))
    expect(screen.queryByText(/Failed to load repositories/)).not.toBeInTheDocument()
  })

  it('labels the confirm button "Unlink" for a local repository', async () => {
    mocks.listRepos.mockResolvedValue([createRepo()])
    const user = userEvent.setup()

    renderRepoList()
    const dialog = await openRepoDeleteDialog(user)

    expect(within(dialog).getByText('Unlink Repository')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('labels the confirm button "Delete" for a cloned repository', async () => {
    mocks.listRepos.mockResolvedValue([
      createRepo({ id: 2, name: 'cloned', localPath: 'cloned', repoUrl: 'https://github.com/test/cloned', isLocal: false }),
    ])
    const user = userEvent.setup()

    renderRepoList()
    const dialog = await openRepoDeleteDialog(user)

    expect(within(dialog).getByText('Delete Repository')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
