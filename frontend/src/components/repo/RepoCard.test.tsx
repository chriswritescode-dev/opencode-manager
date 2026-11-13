import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoCard } from './RepoCard'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { renderWithProviders, connectTestEventStream } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeRepo } from '@/test/fixtures/api'
import { permissionAsked } from '@/test/fixtures/events'
import type { FetchRoute } from '@/test/fetchFake'
import type { Repo } from '@/api/types'
import type { GitStatusResponse } from '@/types/git'

const REPO_PATH = '/Users/test/repos/test-repo'

function makeCardRepo(overrides: Partial<Repo> = {}): Repo {
  return makeRepo({
    id: 1,
    name: 'test-repo',
    repoUrl: 'https://github.com/test/test-repo',
    localPath: 'repos/test-repo',
    fullPath: REPO_PATH,
    defaultBranch: 'main',
    clonedAt: 0,
    branch: 'main',
    currentBranch: 'main',
    cloneStatus: 'ready',
    isWorktree: false,
    isLocal: false,
    ...overrides,
  })
}

function makeGitStatus(overrides: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: [],
    hasChanges: false,
    operation: null,
    ...overrides,
  }
}

const eventProviderRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/repos', respond: () => ({ json: [makeCardRepo()] }) },
  { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
]

function renderCard(options: {
  repo?: Repo
  gitStatus?: GitStatusResponse
  activityLabel?: string
  manageMode?: boolean
  selectionMode?: boolean
  onSelect?: (id: number, selected: boolean) => void
  extraRoutes?: FetchRoute[]
} = {}) {
  const capturedPathname = { current: '' }
  const onDelete = vi.fn()
  const view = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={{ current: '' }} />
      <RepoCard
        repo={options.repo ?? makeCardRepo()}
        onDelete={onDelete}
        isDeleting={false}
        isSelected={false}
        onSelect={options.onSelect}
        gitStatus={options.gitStatus}
        manageMode={options.manageMode}
        selectionMode={options.selectionMode}
        activityLabel={options.activityLabel}
      />
    </>,
    { events: true, fetchRoutes: [...(options.extraRoutes ?? []), ...eventProviderRoutes] },
  )
  return { ...view, capturedPathname, onDelete }
}

describe('RepoCard', () => {
  beforeEach(() => {
    useSessionStatus.setState({ statuses: new Map(), directories: new Map() })
  })

  it('does not navigate when cloneStatus is not ready', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderCard({ repo: makeCardRepo({ cloneStatus: 'cloning' }) })

    await user.click(screen.getByText('test-repo'))

    expect(capturedPathname.current).toBe('/')
  })

  it('navigates to the repository when the card is ready', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderCard()

    await user.click(screen.getByText('test-repo'))

    expect(capturedPathname.current).toBe('/repos/1')
  })

  it('should not show checkbox when onSelect is not provided', () => {
    renderCard()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('should call onSelect when card is clicked in selection mode', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { capturedPathname } = renderCard({ onSelect, selectionMode: true })

    await user.click(screen.getByText('test-repo'))

    expect(onSelect).toHaveBeenCalledWith(1, true)
    expect(capturedPathname.current).toBe('/')
  })

  it('should not show checkbox in manage mode or selection mode', () => {
    renderCard({ manageMode: true, selectionMode: true, onSelect: vi.fn() })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('should show a dirty state indicator when gitStatus has changes', () => {
    const { container } = renderCard({
      gitStatus: makeGitStatus({
        files: [{ path: 'file.txt', status: 'modified', staged: false }],
        hasChanges: true,
      }),
    })

    expect(container.querySelector('.bg-highlight')).not.toBeNull()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('should show ahead/behind indicators when gitStatus has ahead or behind', () => {
    renderCard({ gitStatus: makeGitStatus({ ahead: 2, behind: 1 }) })

    expect(screen.getByText(/↑2/)).toBeInTheDocument()
    expect(screen.getByText(/↓1/)).toBeInTheDocument()
  })

  it('should display the activity label when provided', () => {
    renderCard({ activityLabel: '2h ago' })

    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  it('should show the cloning state', () => {
    renderCard({ repo: makeCardRepo({ cloneStatus: 'cloning' }) })

    expect(screen.getByText('Cloning...')).toBeInTheDocument()
  })

  it('should show the running indicator when a session in the repo is running', () => {
    useSessionStatus.getState().setStatus('ses_1', { type: 'busy' })
    useSessionStatus.getState().setSessionDirectory('ses_1', REPO_PATH)

    renderCard()

    expect(screen.getByLabelText('Sessions running')).toBeInTheDocument()
  })

  it('should show the needs-input indicator when a session in the repo needs input', async () => {
    const { eventStream } = renderCard()
    await connectTestEventStream(eventStream)

    act(() => {
      eventStream?.message(
        permissionAsked(
          {
            id: 'permission-1',
            sessionID: 'ses_1',
            action: 'bash',
            resources: ['echo hello'],
            metadata: {},
          },
          { directory: REPO_PATH },
        ),
      )
    })

    expect(await screen.findByLabelText('Session needs input')).toBeInTheDocument()
  })

  it('should not show an activity indicator when the repo is idle', () => {
    renderCard()

    expect(screen.queryByLabelText('Sessions running')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Session needs input')).not.toBeInTheDocument()
  })
})
