import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createUseSettingsMock } from '@/test/test-utils'
import { RepoList } from './RepoList'

const mocks = vi.hoisted(() => ({ listRepos: vi.fn() }))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
  deleteRepo: vi.fn(),
  updateRepoOrder: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => createUseSettingsMock(),
}))

vi.mock('@/hooks/useMobile', () => ({ useMobile: () => true }))

function renderRepoList(onAddRepo: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <RepoList onAddRepo={onAddRepo} />
    </QueryClientProvider>,
  )
}

describe('RepoList', () => {
  it('calls onAddRepo once from the empty state', async () => {
    mocks.listRepos.mockResolvedValue([])
    const onAddRepo = vi.fn()
    const user = userEvent.setup()

    renderRepoList(onAddRepo)

    await user.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(onAddRepo).toHaveBeenCalledTimes(1)
  })
})
