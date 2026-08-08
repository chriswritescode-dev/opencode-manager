import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoCard } from './RepoCard'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const defaultProps = {
  repo: {
    id: 1,
    repoUrl: 'https://github.com/test/test-repo',
    localPath: 'repos/test-repo',
    fullPath: '/Users/test/repos/test-repo',
    branch: 'main',
    currentBranch: 'main',
    cloneStatus: 'ready' as const,
    isWorktree: false,
    isLocal: false,
  },
  onDelete: vi.fn(),
  isDeleting: false,
  isSelected: false,
  onSelect: vi.fn(),
}

const renderWithRouter = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  )
}

describe('RepoCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not navigate when cloneStatus is not ready', () => {
    const props = {
      ...defaultProps,
      repo: { ...defaultProps.repo, cloneStatus: 'cloning' as const },
    }
    renderWithRouter(<RepoCard {...props} />)

    fireEvent.click(screen.getByText('test-repo'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('should not show checkbox when onSelect is not provided', () => {
    const { onSelect, ...propsWithoutSelect } = defaultProps
    void onSelect
    renderWithRouter(<RepoCard {...propsWithoutSelect} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('should not show checkbox in any mode', () => {
    const props = {
      ...defaultProps,
      onSelect: vi.fn(),
    }
    renderWithRouter(<RepoCard {...props} manageMode={true} selectionMode={true} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('should call onSelect when card is clicked in selection mode', () => {
    const onSelect = vi.fn()
    const props = {
      ...defaultProps,
      onSelect,
      selectionMode: true,
    }
    renderWithRouter(<RepoCard {...props} />)

    fireEvent.click(screen.getByText('test-repo'))
    expect(onSelect).toHaveBeenCalledWith(1, true)
  })

  it('should not navigate when card is clicked in selection mode', () => {
    const onSelect = vi.fn()
    const props = {
      ...defaultProps,
      onSelect,
      selectionMode: true,
    }
    renderWithRouter(<RepoCard {...props} />)

    fireEvent.click(screen.getByText('test-repo'))
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(1, true)
  })

  it('should show dirty state indicator when gitStatus has changes', () => {
    const props = {
      ...defaultProps,
      gitStatus: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'file.txt', status: 'modified' as const, staged: false }],
        hasChanges: true,
      },
    }
    const { container } = renderWithRouter(<RepoCard {...props} />)

    const indicator = container.querySelector('.bg-orange-500')
    expect(indicator).toBeTruthy()
  })

  it('should show ahead/behind indicators when gitStatus has ahead or behind', () => {
    const props = {
      ...defaultProps,
      gitStatus: {
        branch: 'main',
        ahead: 2,
        behind: 1,
        files: [],
        hasChanges: false,
      },
    }
    renderWithRouter(<RepoCard {...props} />)

    expect(screen.getByText(/↑2/)).toBeInTheDocument()
    expect(screen.getByText(/↓1/)).toBeInTheDocument()
  })

  it('should display activity label when provided', () => {
    const props = {
      ...defaultProps,
      activityLabel: '2h ago',
    }
    renderWithRouter(<RepoCard {...props} />)

    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  it('should show cloning state correctly', () => {
    const props = {
      ...defaultProps,
      repo: { ...defaultProps.repo, cloneStatus: 'cloning' as const },
    }
    renderWithRouter(<RepoCard {...props} />)

    expect(screen.getByText('Cloning...')).toBeInTheDocument()
  })
})