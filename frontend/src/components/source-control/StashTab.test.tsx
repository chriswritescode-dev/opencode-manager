import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { GitStashEntry } from '@opencode-manager/shared'
import { useGitStashes } from '@/api/git'
import { StashTab } from './StashTab'

const { stashPushMutate, stashApplyMutate, stashDropMutate } = vi.hoisted(() => ({
  stashPushMutate: vi.fn(),
  stashApplyMutate: vi.fn(),
  stashDropMutate: vi.fn(),
}))

vi.mock('@/hooks/useGit', () => ({
  useGit: () => ({
    stashPush: { mutate: stashPushMutate, isPending: false },
    stashApply: { mutate: stashApplyMutate, isPending: false },
    stashDrop: { mutate: stashDropMutate, isPending: false },
  }),
}))

vi.mock('@/api/git', () => ({
  useGitStashes: vi.fn(),
}))

const stashEntry: GitStashEntry = {
  index: 0,
  ref: 'stash@{0}',
  hash: 'abc123',
  message: 'wip note',
  branch: 'main',
  date: '2024-01-01T00:00:00+00:00',
}

function mockStashes(stashes: GitStashEntry[]) {
  vi.mocked(useGitStashes).mockReturnValue({
    data: { stashes },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useGitStashes>)
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StashTab repoId={1} />
    </QueryClientProvider>,
  )
}

describe('StashTab', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders stash entries with the message and branch', () => {
    mockStashes([stashEntry])
    renderTab()

    expect(screen.getByText('wip note')).toBeInTheDocument()
    expect(screen.getByText(/main/)).toBeInTheDocument()
  })

  it('wires apply, pop, drop and stash actions to the mutations', async () => {
    const user = userEvent.setup()
    mockStashes([stashEntry])
    renderTab()

    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(stashApplyMutate).toHaveBeenCalledWith({ index: 0, hash: 'abc123', pop: false })

    await user.click(screen.getByRole('button', { name: /pop/i }))
    expect(stashApplyMutate).toHaveBeenCalledWith({ index: 0, hash: 'abc123', pop: true })

    await user.type(screen.getByRole('textbox', { name: 'Stash message' }), 'new stash')
    expect(screen.getByRole('textbox', { name: 'Stash message' })).toHaveValue('new stash')
    await user.click(screen.getByRole('button', { name: /stash changes/i }))
    expect(stashPushMutate).toHaveBeenCalledWith(
      { message: 'new stash', includeUntracked: true },
      expect.any(Object),
    )

    await user.click(screen.getByTitle('Drop stash'))
    await user.click(await screen.findByRole('button', { name: 'Drop' }))
    expect(stashDropMutate).toHaveBeenCalledWith({ index: 0, hash: 'abc123' }, expect.any(Object))
  })
})
