import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoQuickSwitchSheet } from './RepoQuickSwitchSheet'
import { listRepos } from '@/api/repos'

vi.mock('@/api/repos')

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RepoQuickSwitchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with loading state', async () => {
    vi.mocked(listRepos).mockImplementation(() => new Promise(() => {}))
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByText('Switch repo')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search repos...')).toBeInTheDocument()
    })
  })

  it('renders empty state when no repos', async () => {
    vi.mocked(listRepos).mockResolvedValue([])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('No repos found')).toBeInTheDocument()
    })
  })

  it('renders repo list and filters on search', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo2.git',
        localPath: '/path/to/repo2',
        sourcePath: null,
        currentBranch: 'develop',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })
    const input = screen.getByPlaceholderText('Search repos...')
    fireEvent.change(input, { target: { value: 'repo1' } })
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.queryByText('repo2')).not.toBeInTheDocument()
    })
  })

  it('navigates and closes on repo click', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('repo1'))
    expect(handleClose).toHaveBeenCalled()
  })
})
