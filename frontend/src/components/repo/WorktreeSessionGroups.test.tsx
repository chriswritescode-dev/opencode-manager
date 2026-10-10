import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreeSessionGroups } from './WorktreeSessionGroups'
import type { RepoSibling } from '@/api/repos'
import type { Session } from '@/api/types'
import type { MultiRun } from '@opencode-manager/shared/schemas'

const makeWorktree = (overrides: Partial<RepoSibling> & Pick<RepoSibling, 'fullPath' | 'currentBranch' | 'worktreeSource'>): RepoSibling => ({
  id: -1,
  localPath: 'x',
  fullPath: overrides.fullPath,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
  isWorktree: true,
  currentBranch: overrides.currentBranch,
  worktreeSource: overrides.worktreeSource,
  ...overrides,
})

const featureWorktree = makeWorktree({
  fullPath: '/w/feature',
  currentBranch: 'feature/auth',
  worktreeSource: 'opencode',
})

const sharedScheduleWorktree = makeWorktree({
  fullPath: '/s/job-14-shared',
  currentBranch: 'schedule/14/shared',
  worktreeSource: 'schedule',
  schedule: { repoId: 1, jobId: 14, runId: null, inUse: true, name: 'Nightly' },
})

const runScheduleWorktree = makeWorktree({
  fullPath: '/s/job-14-run-340',
  currentBranch: 'schedule/14/run-340',
  worktreeSource: 'schedule',
  schedule: { repoId: 1, jobId: 14, runId: 340, inUse: false, name: 'Nightly' },
})

const manualWorktree = makeWorktree({
  fullPath: '/w/manual',
  currentBranch: 'manual',
  worktreeSource: 'git',
})

const themeOneWorktree = makeWorktree({
  fullPath: '/w/theme-1',
  currentBranch: 'theme-toggle-1',
  worktreeSource: 'opencode',
})

const themeTwoWorktree = makeWorktree({
  fullPath: '/w/theme-2',
  currentBranch: 'theme-toggle-2',
  worktreeSource: 'opencode',
})

const allWorktrees = [featureWorktree, sharedScheduleWorktree, runScheduleWorktree, manualWorktree]

const themeToggleRun: MultiRun = {
  id: 7,
  repoId: 1,
  name: 'Theme toggle',
  prompt: 'Add a theme toggle',
  isolated: true,
  baseRef: null,
  createdAt: 0,
  entries: [
    {
      id: 1,
      model: 'model-a',
      status: 'started',
      sessionId: 'ses_a',
      directory: '/w/theme-1',
      isolated: true,
      error: null,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 2,
      model: 'model-b',
      status: 'started',
      sessionId: 'ses_b',
      directory: '/w/theme-2',
      isolated: true,
      error: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  fusions: [],
}

const makeSession = (id: string, title: string, directory: string): Session => ({
  id,
  title,
  parentID: undefined,
  location: { directory },
  time: { created: 0, updated: 0 },
} as unknown as Session)

const featureSession = makeSession('ses_1', 'Auth work', '/w/feature')

const onNewSession = vi.fn()
const onOpenTerminal = vi.fn()
const onCreateWorktree = vi.fn()
const onDelete = vi.fn()

beforeEach(() => {
  localStorage.clear()
  onNewSession.mockReset()
  onOpenTerminal.mockReset()
  onCreateWorktree.mockReset()
  onDelete.mockReset()
})

function renderGroups(overrides: {
  worktrees?: RepoSibling[]
  sessions?: Session[]
  multiRuns?: MultiRun[]
  searchQuery?: string
  onExpandedScheduleDirectoriesChange?: (directories: string[]) => void
} = {}) {
  return render(
    <WorktreeSessionGroups
      repoId={1}
      worktrees={overrides.worktrees ?? allWorktrees}
      sessions={overrides.sessions ?? [featureSession]}
      multiRuns={overrides.multiRuns}
      searchQuery={overrides.searchQuery ?? ''}
      renderSessionCard={(session) => <div key={session.id}>{session.title}</div>}
      onExpandedScheduleDirectoriesChange={overrides.onExpandedScheduleDirectoriesChange}
      onNewSession={onNewSession}
      onOpenTerminal={onOpenTerminal}
      onCreateWorktree={onCreateWorktree}
      onDelete={onDelete}
    />,
  )
}

describe('WorktreeSessionGroups', () => {
  it('groups sessions under their worktree with owner badges, schedule header and in-use pill', async () => {
    renderGroups()

    expect(screen.getByText('feature/auth')).toBeInTheDocument()
    expect(screen.getByText('OpenCode')).toBeInTheDocument()
    expect(screen.getByText('Auth work')).toBeInTheDocument()
    expect(screen.getByText('1 session')).toBeInTheDocument()

    expect(screen.getByText('Nightly')).toBeInTheDocument()
    expect(screen.getByText('Schedule · Shared worktree')).toBeInTheDocument()
    expect(screen.getByText('Schedule · Run #340')).toBeInTheDocument()
    expect(screen.getByText('in use')).toBeInTheDocument()

    expect(screen.getByText('Git')).toBeInTheDocument()
    expect(screen.getByText('No sessions in manual · Start one')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /No sessions in manual/ }))
    expect(onNewSession).toHaveBeenCalledWith('/w/manual')

    await userEvent.click(screen.getByRole('button', { name: 'Open terminal in manual' }))
    expect(onOpenTerminal).toHaveBeenCalledWith('/w/manual')
  })

  it('disables delete for the in-use worktree and deletes the run worktree after confirmation', async () => {
    renderGroups()

    expect(screen.getByRole('button', { name: 'Delete worktree schedule/14/shared' })).toBeDisabled()
    const runDelete = screen.getByRole('button', { name: 'Delete worktree schedule/14/run-340' })
    expect(runDelete).toBeEnabled()

    await userEvent.click(runDelete)
    const dialog = screen.getByRole('dialog', { name: 'Delete Worktree' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith(['/s/job-14-run-340'])
  })

  it('cleans up only the non-in-use worktrees of a schedule after confirmation', async () => {
    renderGroups()

    await userEvent.click(screen.getByRole('button', { name: 'Clean up' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Worktree' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith(['/s/job-14-run-340'])
  })

  it('cleans up worktrees of a schedule that the search is hiding', async () => {
    renderGroups({ sessions: [makeSession('ses_2', 'Audit run', '/s/job-14-shared')], searchQuery: 'audit' })

    expect(screen.queryByText('schedule/14/run-340')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Clean up' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Worktree' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith(['/s/job-14-run-340'])
  })

  it('filters to only the git worktree when the Git owner chip is selected', async () => {
    renderGroups()

    await userEvent.click(screen.getByRole('button', { name: 'Git 1' }))

    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(screen.queryByText('feature/auth')).not.toBeInTheDocument()
    expect(screen.queryByText('Nightly')).not.toBeInTheDocument()
  })

  it('collapses a worktree and persists the collapsed state across remount', async () => {
    const { unmount } = renderGroups()
    expect(screen.getByText('Auth work')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { expanded: true, name: /feature\/auth/ }))
    expect(screen.queryByText('Auth work')).not.toBeInTheDocument()

    unmount()
    renderGroups()
    expect(screen.queryByText('Auth work')).not.toBeInTheDocument()
  })

  it('reports a schedule worktree directory only after its group is expanded', async () => {
    const onExpandedScheduleDirectoriesChange = vi.fn()
    renderGroups({ onExpandedScheduleDirectoriesChange })

    expect(onExpandedScheduleDirectoriesChange).toHaveBeenLastCalledWith([])

    await userEvent.click(screen.getByRole('button', { expanded: false, name: /schedule\/14\/shared/ }))

    expect(onExpandedScheduleDirectoriesChange).toHaveBeenLastCalledWith(['/s/job-14-shared'])
  })

  it('renders multi-run worktrees as one card with inline sessions and no per-worktree collapse', async () => {
    renderGroups({
      worktrees: [themeOneWorktree, themeTwoWorktree, manualWorktree],
      sessions: [
        makeSession('ses_theme_1', 'Theme one work', '/w/theme-1'),
        makeSession('ses_theme_2', 'Theme two work', '/w/theme-2'),
      ],
      multiRuns: [themeToggleRun],
    })

    const header = screen.getByRole('button', { name: /Theme toggle/ })
    expect(screen.getByText(/2 worktrees/)).toBeInTheDocument()
    expect(screen.getByText('theme-toggle-1')).toBeInTheDocument()
    expect(screen.getByText('theme-toggle-2')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()

    const card = header.closest('.rounded-md') as HTMLElement
    expect(card).not.toBeNull()
    expect(within(card).getAllByRole('button', { expanded: true })).toHaveLength(1)
    expect(within(card).queryAllByRole('button', { expanded: false })).toHaveLength(0)

    expect(screen.getByText('Theme one work')).toBeInTheDocument()
    expect(screen.getByText('Theme two work')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'New session in theme-toggle-1' }))
    expect(onNewSession).toHaveBeenCalledWith('/w/theme-1')

    await userEvent.click(header)

    expect(screen.queryByText('theme-toggle-1')).not.toBeInTheDocument()
    expect(screen.queryByText('theme-toggle-2')).not.toBeInTheDocument()
    expect(screen.queryByText('Theme one work')).not.toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button', { expanded: true })).toHaveLength(0)
  })

  it('hides empty worktrees while searching and renders the empty state when there are none', async () => {
    const { unmount } = renderGroups({ searchQuery: 'auth' })

    expect(screen.getByText('feature/auth')).toBeInTheDocument()
    expect(screen.queryByText('manual')).not.toBeInTheDocument()
    expect(screen.queryByText('Nightly')).not.toBeInTheDocument()

    unmount()
    renderGroups({ worktrees: [], sessions: [] })

    expect(screen.getByText('No worktrees yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New worktree' }))
    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
  })
})
