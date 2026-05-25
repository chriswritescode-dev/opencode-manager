import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreeTabs } from './WorktreeTabs'
import type { RepoSibling } from '@/api/repos'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const makeSibling = (id: number, branch: string, isWorktree = true): RepoSibling => ({
  id, localPath: `repo-${id}`, fullPath: `/w/repo-${id}`,
  defaultBranch: 'main', cloneStatus: 'ready', clonedAt: 0,
  isWorktree, currentBranch: branch, branch,
})

beforeEach(() => navigate.mockReset())

describe('WorktreeTabs', () => {
  it('returns null when 0 siblings', () => {
    const { container } = render(<WorktreeTabs siblings={[]} activeRepoId={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when only self', () => {
    const siblings = [makeSibling(1, 'main', false)]
    const { container } = render(<WorktreeTabs siblings={siblings} activeRepoId={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one tab per sibling when >= 2', () => {
    const siblings = [
      makeSibling(1, 'main', false),
      makeSibling(2, 'feature-a', true),
      makeSibling(3, 'feature-b', true),
    ]
    render(<WorktreeTabs siblings={siblings} activeRepoId={1} />)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('feature-a')).toBeInTheDocument()
    expect(screen.getByText('feature-b')).toBeInTheDocument()
  })

  it('marks active tab', () => {
    const siblings = [
      makeSibling(1, 'main', false),
      makeSibling(2, 'feature-a', true),
      makeSibling(3, 'feature-b', true),
    ]
    render(<WorktreeTabs siblings={siblings} activeRepoId={2} />)
    const triggers = screen.getAllByRole('tab')
    expect(triggers[0]).toHaveAttribute('data-state', 'inactive')
    expect(triggers[1]).toHaveAttribute('data-state', 'active')
    expect(triggers[2]).toHaveAttribute('data-state', 'inactive')
  })

  it('clicking a non-active tab navigates to /repos/<id>', async () => {
    const siblings = [
      makeSibling(1, 'main', false),
      makeSibling(2, 'feature-a', true),
    ]
    render(<WorktreeTabs siblings={siblings} activeRepoId={1} />)
    const tabs = screen.getAllByRole('tab')
    await userEvent.click(tabs[1])
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repos/2'))
  })

  it('clicking the active tab does NOT navigate', async () => {
    const siblings = [
      makeSibling(1, 'main', false),
      makeSibling(2, 'feature-a', true),
    ]
    render(<WorktreeTabs siblings={siblings} activeRepoId={1} />)
    const tabs = screen.getAllByRole('tab')
    await userEvent.click(tabs[0])
    expect(navigate).not.toHaveBeenCalled()
  })
})
