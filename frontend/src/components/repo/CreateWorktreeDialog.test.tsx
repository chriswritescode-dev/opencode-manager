import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateWorktreeDialog } from './CreateWorktreeDialog'
import { createRepo, listBranches } from '@/api/repos'

vi.mock('@/api/repos', () => ({
  createRepo: vi.fn(),
  listBranches: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const repoUrl = 'git@example.com:org/repo.git'

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateWorktreeDialog open onOpenChange={vi.fn()} repoId={1} repoUrl={repoUrl} />
    </QueryClientProvider>,
  )
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
    vi.mocked(listBranches).mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'feature', type: 'local', current: false },
        { name: 'wt-branch', type: 'local', current: false, isWorktree: true },
        { name: 'remotes/origin/feature', type: 'remote', current: false },
        { name: 'remotes/origin/release', type: 'remote', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
    vi.mocked(createRepo).mockResolvedValue({} as never)
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

    await waitFor(() => expect(createRepo).toHaveBeenCalledTimes(1))
    expect(createRepo).toHaveBeenCalledWith({ repoUrl, branch: 'release', useWorktree: true })
    expect(vi.mocked(createRepo).mock.calls[0][0]).not.toHaveProperty('baseBranch')
  })

  it('does not offer remote-only branches from non-origin remotes', async () => {
    vi.mocked(listBranches).mockResolvedValue({
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
    vi.mocked(listBranches).mockResolvedValue({
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

    await waitFor(() => expect(createRepo).toHaveBeenCalledTimes(1))
    expect(createRepo).toHaveBeenCalledWith({
      repoUrl,
      branch: 'my-new-branch',
      useWorktree: true,
      baseBranch: 'main',
    })
  })

  it('prompts to use existing mode when a new branch name already exists', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature')

    expect(await screen.findByText('Use Existing branch instead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
  })
})
