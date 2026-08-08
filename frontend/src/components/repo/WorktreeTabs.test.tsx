import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreeTabs } from './WorktreeTabs'
import type { RepoSibling } from '@/api/repos'

const makeWorkspaceSibling = (workspaceId: string, branch: string): RepoSibling => ({
  id: -1,
  localPath: branch,
  fullPath: `/w/${branch}`,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
  isWorktree: true,
  currentBranch: branch,
  branch,
  workspaceId,
  workspaceName: branch,
})

const onValueChange = vi.fn()

beforeEach(() => {
  onValueChange.mockReset()
})

describe('WorktreeTabs', () => {
  it('renders the repo tab with a create-workspace button when there are no workspaces', () => {
    render(
      <WorktreeTabs workspaces={[]} value="repo" onValueChange={onValueChange} baseLabel="main" />
    )
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('renders Repo and Workspaces tabs when at least one workspace exists', () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(<WorktreeTabs workspaces={workspaces} value="repo" onValueChange={onValueChange} baseLabel="main" />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('marks the active tab', () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(<WorktreeTabs workspaces={workspaces} value="workspaces" onValueChange={onValueChange} baseLabel="main" />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('data-state', 'inactive')
    expect(tabs[1]).toHaveAttribute('data-state', 'active')
  })

  it('calls onValueChange when a different tab is clicked', async () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(<WorktreeTabs workspaces={workspaces} value="repo" onValueChange={onValueChange} baseLabel="main" />)

    await userEvent.click(screen.getAllByRole('tab')[1])
    expect(onValueChange).toHaveBeenCalledWith('workspaces')
  })

  it('shows the workspace count in the workspaces tab', () => {
    const workspaces = [
      makeWorkspaceSibling('wrk_a', 'feature-a'),
      makeWorkspaceSibling('wrk_b', 'feature-b'),
      makeWorkspaceSibling('wrk_c', 'feature-c'),
    ]
    render(<WorktreeTabs workspaces={workspaces} value="repo" onValueChange={onValueChange} baseLabel="main" />)

    expect(screen.getByText('(3)')).toBeInTheDocument()
  })
})
