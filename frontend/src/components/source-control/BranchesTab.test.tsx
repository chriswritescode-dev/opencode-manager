import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

import { listBranches, getRepo } from '@/api/repos'

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
})
