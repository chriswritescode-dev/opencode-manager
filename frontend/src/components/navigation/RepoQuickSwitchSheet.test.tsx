import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoQuickSwitchSheet } from './RepoQuickSwitchSheet'
import { listRepos } from '@/api/repos'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'

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

function LocationSpy() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function MobileSheetHarness() {
  const { close } = useMobileTabBar()
  return (
    <>
      <RepoQuickSwitchSheet isOpen onClose={close} />
      <LocationSpy />
    </>
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
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument()
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
    const input = screen.getByPlaceholderText('Search projects...')
    fireEvent.change(input, { target: { value: 'repo1' } })
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.queryByText('repo2')).not.toBeInTheDocument()
    })
  })

  it('does not show assistant as a repo option', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: ASSISTANT_REPO_ID,
        repoUrl: 'Assistant',
        localPath: '/assistant',
        sourcePath: null,
        currentBranch: null,
        isLocal: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
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

    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
  })

  it('navigates on repo click and closes sheet', async () => {
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

  it('navigates to assistant when mobileTabAction is assistant', async () => {
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
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/schedules?mobileTab=repos&mobileTabAction=assistant']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/assistant')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('navigates from assistant to repo detail when clicking repo on canonical assistant route', async () => {
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
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('navigates from legacy assistant route to repo detail when clicking repo', async () => {
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
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('does not mark any repo active on /assistant', async () => {
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
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()
  })

  it('does not mark any repo active on legacy /repos/1/assistant', async () => {
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
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()
  })

  it('switches repos from the mobile repos sheet without navigating back to the previous repo', async () => {
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
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1?mobileTab=repos']}>
          <Routes>
            <Route path="*" element={<MobileSheetHarness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo2'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/2')
  })
})
