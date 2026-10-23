import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGitStatus } from '@/api/git'
import type { GitStatusResponse } from '@/types/git'
import { ChangesTab } from './ChangesTab'

const { commitMutate } = vi.hoisted(() => ({ commitMutate: vi.fn() }))

vi.mock('@/hooks/useGit', () => ({
  useGit: () => ({
    commit: { mutate: commitMutate, isPending: false },
    stageFiles: { mutate: vi.fn(), isPending: false },
    unstageFiles: { mutate: vi.fn(), isPending: false },
    discardFiles: { mutate: vi.fn(), isPending: false },
    generateCommitMessage: { mutate: vi.fn(), isPending: false },
  }),
}))

vi.mock('@/api/git', () => ({
  useGitStatus: vi.fn(),
}))

vi.mock('./RepoGitIdentitySelect', () => ({
  RepoGitIdentitySelect: () => null,
}))

vi.mock('@/components/file-browser/FileDiffView', () => ({
  FileDiffView: () => null,
}))

const stagedStatus: GitStatusResponse = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  hasChanges: true,
  operation: null,
  files: [
    { path: 'notes.txt', status: 'modified', staged: true },
    { path: 'todo.txt', status: 'modified', staged: false },
  ],
}

function renderTab() {
  vi.mocked(useGitStatus).mockReturnValue({
    data: stagedStatus,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useGitStatus>)

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChangesTab repoId={1} onFileSelect={vi.fn()} isMobile={false} />
    </QueryClientProvider>,
  )
}

describe('ChangesTab commit message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the message when the commit fails', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.type(screen.getByPlaceholderText('Commit message...'), 'fix the thing')
    await user.click(screen.getByRole('button', { name: /^Commit/ }))

    expect(commitMutate).toHaveBeenCalledWith(
      { message: 'fix the thing' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(screen.getByPlaceholderText('Commit message...')).toHaveValue('fix the thing')
  })

  it('clears the message after a successful commit', async () => {
    const user = userEvent.setup()
    commitMutate.mockImplementation((_variables, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
    renderTab()

    await user.type(screen.getByPlaceholderText('Commit message...'), 'fix the thing')
    await user.click(screen.getByRole('button', { name: /^Commit/ }))

    expect(screen.getByPlaceholderText('Commit message...')).toHaveValue('')
  })
})
