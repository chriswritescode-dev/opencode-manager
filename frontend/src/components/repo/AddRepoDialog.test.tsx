import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddRepoDialog } from './AddRepoDialog'

const mocks = vi.hoisted(() => ({
  createRepo: vi.fn(),
  discoverRepos: vi.fn(),
  listRepos: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  createRepo: mocks.createRepo,
  discoverRepos: mocks.discoverRepos,
  listRepos: mocks.listRepos,
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

function Harness() {
  const [open, setOpen] = useState(true)
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))

  return (
    <QueryClientProvider client={queryClient}>
      <button onClick={() => setOpen(true)}>reopen</button>
      <AddRepoDialog open={open} onOpenChange={setOpen} />
    </QueryClientProvider>
  )
}

describe('AddRepoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRepos.mockResolvedValue([])
  })

  it('links each field label to its input', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Directory Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Branch (optional)')).toBeInTheDocument()
  })

  it('rejects a URL containing whitespace before submitting', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Repository URL'), 'not a url !!')

    expect(screen.getByText('Enter a valid repository URL without spaces.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeDisabled()
    expect(mocks.createRepo).not.toHaveBeenCalled()
  })

  it('clears the previous error and input when reopened', async () => {
    mocks.createRepo.mockRejectedValue(new Error('Repository not found or access denied: https://github.com/test/missing.'))
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText('Repository URL')
    await user.type(input, 'test/missing')
    await user.click(screen.getByRole('button', { name: 'Add Repository' }))

    expect(await screen.findByText('Repository not found or access denied: https://github.com/test/missing.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'reopen' }))

    expect(screen.getByLabelText('Repository URL')).toHaveValue('')
    expect(screen.queryByText('Repository not found or access denied: https://github.com/test/missing.')).not.toBeInTheDocument()
  })
})
