import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BranchesTab } from './BranchesTab'

const mutateAsync = vi.fn()

vi.mock('@/api/repos', () => {
  class GitAuthError extends Error {}
  return {
    GitAuthError,
    listBranches: vi.fn(),
    getRepo: vi.fn(),
    switchBranch: vi.fn(),
  }
})

vi.mock('@/api/git', () => ({
  fetchGitStatus: vi.fn(),
  useGitStatus: () => ({ data: undefined, dataUpdatedAt: 0 }),
}))

vi.mock('@/hooks/useGit', () => ({
  useGit: () => ({
    createBranch: { isPending: false, mutateAsync },
    switchBranch: { isPending: false, mutateAsync },
    renameBranch: { isPending: false, mutateAsync },
    deleteBranch: { isPending: false, mutateAsync },
    integrateBranch: { isPending: false, mutate: vi.fn() },
  }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/components/repo/CreateWorktreeDialog', () => ({
  CreateWorktreeDialog: () => null,
}))

import { listBranches, getRepo, switchBranch } from '@/api/repos'
import { fetchGitStatus } from '@/api/git'

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listBranches).mockResolvedValue({
    branches: [
      { name: 'main', type: 'local', current: true },
      { name: 'feature', type: 'local', current: false },
    ],
    status: { ahead: 0, behind: 0 },
  })
  vi.mocked(getRepo).mockResolvedValue({ repoUrl: 'git@example.com:org/repo.git', isWorktree: false } as never)
})

describe('BranchesTab', () => {
  it('gives the inline rename textbox a descriptive accessible name', async () => {
    const user = userEvent.setup()
    render(<BranchesTab repoId={1} currentBranch="main" />, { wrapper: createWrapper() })

    await user.click(await screen.findByRole('button', { name: 'Actions for feature' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    expect(screen.getByRole('textbox', { name: 'New name for branch feature' })).toBeInTheDocument()
  })

  it('shows the upstream branch name in the delete dialog', async () => {
    vi.mocked(listBranches).mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'feature', type: 'local', current: false, upstream: 'origin/feature' },
      ],
      status: { ahead: 0, behind: 0 },
    })
    const user = userEvent.setup()
    render(<BranchesTab repoId={1} currentBranch="main" />, { wrapper: createWrapper() })

    await user.click(await screen.findByRole('button', { name: 'Actions for feature' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('origin/feature')).toBeInTheDocument()
  })

  it('invalidates the vcs info of the switched repository', async () => {
    vi.mocked(switchBranch).mockResolvedValue({
      id: 1,
      fullPath: '/abs/repos/my-repo',
      currentBranch: 'feature',
    } as never)
    vi.mocked(fetchGitStatus).mockResolvedValue({
      branch: 'feature',
      ahead: 0,
      behind: 0,
      files: [],
      hasChanges: false,
      operation: null,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()
    render(<BranchesTab repoId={1} currentBranch="main" />, {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    })

    await user.click(await screen.findByRole('button', { name: /^feature/ }))

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['opencode', 'vcs', '/abs/repos/my-repo', 'info'],
      exact: true,
    }))
  })
})
