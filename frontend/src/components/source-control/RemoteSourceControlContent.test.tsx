import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import { RemoteSourceControlContent } from './RemoteSourceControlContent'

const SERVER_ID = 'srv_kitchen'
const DIRECTORY = '/home/me/app'
const remoteApi = `/api/opencode/servers/${SERVER_ID}/api`

const WORKING_FILES = [
  { file: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' },
  { file: 'src/new.ts', additions: 5, deletions: 0, status: 'added' },
]

const WORKING_DIFF = [
  {
    file: 'src/app.ts',
    patch: '@@ -1,2 +1,2 @@\n-old line\n+new line',
    additions: 1,
    deletions: 1,
    status: 'modified',
  },
]

const BRANCH_DIFF = [
  {
    file: 'src/branch-only.ts',
    patch: '@@ -1,1 +1,2 @@\n branch file\n+extra branch line',
    additions: 1,
    deletions: 0,
    status: 'added',
  },
]

interface ContentOptions {
  status?: FetchRoute['respond']
}

function renderContent(options: ContentOptions = {}) {
  return renderWithProviders(<RemoteSourceControlContent serverId={SERVER_ID} directory={DIRECTORY} />, {
    auth: false,
    theme: false,
    fetchRoutes: [
      {
        method: 'GET',
        path: `${remoteApi}/vcs`,
        respond: () => ({ json: { data: { provider: 'github', branch: { current: 'feature/remote', default: 'main' } } } }),
      },
      {
        method: 'GET',
        path: `${remoteApi}/vcs/status`,
        respond: options.status ?? (() => ({ json: { data: WORKING_FILES } })),
      },
      {
        method: 'GET',
        path: `${remoteApi}/vcs/diff`,
        respond: (request) => ({
          json: { data: request.searchParams.get('mode') === 'branch' ? BRANCH_DIFF : WORKING_DIFF },
        }),
      },
    ],
  })
}

describe('RemoteSourceControlContent', () => {
  it('lists the working-copy changes with the current branch', async () => {
    const { fetchFake } = renderContent()

    expect(await screen.findByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('new.ts')).toBeInTheDocument()
    expect(screen.getByText('feature/remote')).toBeInTheDocument()
    expect(fetchFake.lastRequest('GET', `${remoteApi}/vcs/status`)?.searchParams.get('location[directory]')).toBe(DIRECTORY)
  })

  it('switches to branch changes and lists the diff files', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderContent()

    await user.click(await screen.findByRole('button', { name: 'Branch changes' }))

    expect(await screen.findByText('branch-only.ts')).toBeInTheDocument()
    expect(screen.queryByText('new.ts')).not.toBeInTheDocument()
    expect(fetchFake.lastRequest('GET', `${remoteApi}/vcs/diff`)?.searchParams.get('mode')).toBe('branch')
  })

  it('shows the patch after selecting a changed file', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderContent()

    await user.click(await screen.findByText('app.ts'))

    expect(await screen.findByText('new line')).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchFake.lastRequest('GET', `${remoteApi}/vcs/diff`)?.searchParams.get('mode')).toBe('working'),
    )

    await user.click(screen.getByRole('button', { name: 'Back to changed files' }))

    expect(await screen.findByText('new.ts')).toBeInTheDocument()
  })

  it('shows an empty state when the working copy has no changes', async () => {
    renderContent({ status: () => ({ json: { data: [] } }) })

    expect(await screen.findByText('No working changes')).toBeInTheDocument()
  })

  it('reports a failed status load', async () => {
    renderContent({
      status: () => {
        throw new Error('vcs unavailable')
      },
    })

    expect(await screen.findByText('Failed to load changes')).toBeInTheDocument()
    expect(screen.getByText('Transport: vcs unavailable')).toBeInTheDocument()
  })
})
