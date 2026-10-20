import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RemoteSourceControlContent } from './RemoteSourceControlContent'

const mocks = vi.hoisted(() => ({
  getVcsInfo: vi.fn(),
  listVcsStatus: vi.fn(),
  getVcsDiff: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  getVcsInfo: mocks.getVcsInfo,
  listVcsStatus: mocks.listVcsStatus,
  getVcsDiff: mocks.getVcsDiff,
}))

const WORKING_FILES = [
  { file: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' as const },
  { file: 'src/new.ts', additions: 5, deletions: 0, status: 'added' as const },
]

const WORKING_DIFF = [
  {
    file: 'src/app.ts',
    patch: '@@ -1,2 +1,2 @@\n-old line\n+new line',
    additions: 1,
    deletions: 1,
    status: 'modified' as const,
  },
]

const BRANCH_DIFF = [
  {
    file: 'src/branch-only.ts',
    patch: '@@ -1,1 +1,2 @@\n branch file\n+extra branch line',
    additions: 1,
    deletions: 0,
    status: 'added' as const,
  },
]

function renderContent() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <RemoteSourceControlContent serverId="srv_kitchen" directory="/home/me/app" />
    </QueryClientProvider>,
  )
}

describe('RemoteSourceControlContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVcsInfo.mockResolvedValue({
      provider: 'github',
      branch: { current: 'feature/remote', default: 'main' },
    })
    mocks.listVcsStatus.mockResolvedValue(WORKING_FILES)
    mocks.getVcsDiff.mockImplementation((_directory: string, mode: string) =>
      Promise.resolve(mode === 'branch' ? BRANCH_DIFF : WORKING_DIFF),
    )
  })

  it('lists the working-copy changes with the current branch', async () => {
    renderContent()

    expect(await screen.findByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('new.ts')).toBeInTheDocument()
    expect(screen.getByText('feature/remote')).toBeInTheDocument()
    expect(mocks.listVcsStatus).toHaveBeenCalledWith('/home/me/app', 'srv_kitchen')
  })

  it('switches to branch changes and lists the diff files', async () => {
    const user = userEvent.setup()
    renderContent()

    await user.click(await screen.findByRole('button', { name: 'Branch changes' }))

    expect(await screen.findByText('branch-only.ts')).toBeInTheDocument()
    expect(screen.queryByText('new.ts')).not.toBeInTheDocument()
    expect(mocks.getVcsDiff).toHaveBeenCalledWith('/home/me/app', 'branch', 'srv_kitchen')
  })

  it('shows the patch after selecting a changed file', async () => {
    const user = userEvent.setup()
    renderContent()

    await user.click(await screen.findByText('app.ts'))

    expect(await screen.findByText('new line')).toBeInTheDocument()
    expect(mocks.getVcsDiff).toHaveBeenCalledWith('/home/me/app', 'working', 'srv_kitchen')

    await user.click(screen.getByRole('button', { name: 'Back to changed files' }))

    expect(await screen.findByText('new.ts')).toBeInTheDocument()
  })

  it('shows an empty state when the working copy has no changes', async () => {
    mocks.listVcsStatus.mockResolvedValue([])
    renderContent()

    expect(await screen.findByText('No working changes')).toBeInTheDocument()
  })

  it('reports a failed status load', async () => {
    mocks.listVcsStatus.mockRejectedValue(new Error('vcs unavailable'))
    renderContent()

    expect(await screen.findByText('Failed to load changes')).toBeInTheDocument()
    expect(screen.getByText('vcs unavailable')).toBeInTheDocument()
  })
})
