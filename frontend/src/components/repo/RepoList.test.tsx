import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoList } from './RepoList'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { makeRepo } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { Repo } from '@/api/types'

const eventProviderRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
  { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/form', respond: () => ({ json: { data: [] } }) },
]

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return makeRepo({
    id: 1,
    name: 'demo-app',
    localPath: 'demo-app',
    fullPath: '/workspace/repos/demo-app',
    defaultBranch: 'main',
    branch: 'main',
    currentBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    isWorktree: false,
    isLocal: true,
    ...overrides,
  })
}

function renderRepoList(options: {
  onAddRepo?: () => void
  repos?: FetchRoute
  extraRoutes?: FetchRoute[]
  queryClient?: ReturnType<typeof createTestQueryClient>
} = {}) {
  const onAddRepo = options.onAddRepo ?? vi.fn()
  const view = renderWithProviders(<RepoList onAddRepo={onAddRepo} />, {
    events: true,
    queryClient: options.queryClient,
    fetchRoutes: [
      options.repos ?? { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
      { method: 'POST', path: '/api/repos/git-status-batch', respond: () => ({ json: {} }) },
      ...eventProviderRoutes,
      ...(options.extraRoutes ?? []),
    ],
  })
  return { ...view, onAddRepo }
}

async function openRepoDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Unlink Repository|Delete Repository/ }))
  return screen.findByRole('dialog')
}

describe('RepoList', () => {
  it('calls onAddRepo once from the empty state', async () => {
    const user = userEvent.setup()
    const { onAddRepo } = renderRepoList()

    await user.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(onAddRepo).toHaveBeenCalledTimes(1)
  })

  it('shows a search-aware empty message when nothing matches the query', async () => {
    const user = userEvent.setup()
    renderRepoList({
      repos: { method: 'GET', path: '/api/repos', respond: () => ({ json: [createRepo()] }) },
    })

    await screen.findByText('demo-app')
    await user.type(screen.getByPlaceholderText('Search repositories...'), 'zzzz-nomatch')

    expect(await screen.findByText('No repositories found matching "zzzz-nomatch"')).toBeInTheDocument()
    expect(screen.queryByText('No recently accessed repositories')).not.toBeInTheDocument()
  })

  it('keeps the filter empty message when no search query is active', async () => {
    renderRepoList({
      repos: { method: 'GET', path: '/api/repos', respond: () => ({ json: [createRepo({ cloneStatus: 'cloning' })] }) },
    })

    expect(await screen.findByText('No recently accessed repositories')).toBeInTheDocument()
  })

  it('shows the error state when the first load fails', async () => {
    renderRepoList({
      repos: { method: 'GET', path: '/api/repos', respond: () => { throw new Error('offline') } },
    })

    expect(await screen.findByText(/Failed to load repositories/)).toBeInTheDocument()
    expect(screen.getByText(/offline/)).toBeInTheDocument()
  })

  it('keeps cached repositories when the refetch fails', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['repos'], [createRepo()])
    renderRepoList({
      queryClient,
      repos: { method: 'GET', path: '/api/repos', respond: () => { throw new Error('offline') } },
    })

    expect(await screen.findByText('demo-app')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(['repos'])?.status).toBe('error'))
    expect(screen.queryByText(/Failed to load repositories/)).not.toBeInTheDocument()
  })

  it('labels the confirm button "Unlink" for a local repository', async () => {
    const user = userEvent.setup()
    renderRepoList({
      repos: { method: 'GET', path: '/api/repos', respond: () => ({ json: [createRepo()] }) },
    })
    const dialog = await openRepoDeleteDialog(user)

    expect(within(dialog).getByText('Unlink Repository')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('labels the confirm button "Delete" for a cloned repository', async () => {
    const user = userEvent.setup()
    renderRepoList({
      repos: {
        method: 'GET',
        path: '/api/repos',
        respond: () => ({
          json: [
            createRepo({
              id: 2,
              name: 'cloned',
              localPath: 'cloned',
              repoUrl: 'https://github.com/test/cloned',
              isLocal: false,
            }),
          ],
        }),
      },
    })
    const dialog = await openRepoDeleteDialog(user)

    expect(within(dialog).getByText('Delete Repository')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
