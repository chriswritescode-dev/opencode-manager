import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeRepo } from '@/test/fixtures/api'
import { renderRepoDetailPage } from '@/test/repoPage'
import type { Repo, RepoSibling } from '@/api/types'

const baseRepo: Repo = makeRepo({
  id: 1,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
})

const opencodeWorktree: RepoSibling = {
  ...baseRepo,
  id: 2,
  fullPath: '/abs/repos/my-repo-ws',
  currentBranch: 'feature/x',
  branch: 'feature/x',
  isWorktree: true,
  worktreeSource: 'opencode',
}

const scheduleWorktree: RepoSibling = {
  ...baseRepo,
  id: 3,
  fullPath: '/abs/repos/schedule-nightly',
  currentBranch: 'schedule/5/run-7',
  branch: 'schedule/5/run-7',
  isWorktree: true,
  worktreeSource: 'schedule',
  schedule: { repoId: 1, jobId: 5, runId: 7, inUse: false, name: 'Nightly' },
}

function sessionDirectories(requests: Array<{ searchParams: URLSearchParams }>): string[] {
  return requests.map((request) => request.searchParams.get('directory') ?? '')
}

describe('RepoDetail schedule session fetching', () => {
  it('fetches a schedule worktree directory only after its group is expanded', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderRepoDetailPage({
      route: '/repos/1?repoTab=workspaces',
      repo: baseRepo,
      siblings: [opencodeWorktree, scheduleWorktree],
      sessions: (directory) => (directory === '/abs/repos/my-repo-ws' ? [] : []),
    })

    await waitFor(() => {
      const requested = sessionDirectories(fetchFake.findRequests('GET', '/api/opencode/api/session'))
      expect(requested).toContain('/abs/repos/my-repo-ws')
    })
    const beforeExpand = sessionDirectories(fetchFake.findRequests('GET', '/api/opencode/api/session'))
    expect(beforeExpand).not.toContain('/abs/repos/schedule-nightly')

    await user.click(await screen.findByRole('button', { expanded: false, name: /schedule\/5\/run-7/ }))

    await waitFor(() => {
      const requested = sessionDirectories(fetchFake.findRequests('GET', '/api/opencode/api/session'))
      expect(requested).toContain('/abs/repos/schedule-nightly')
    })
  })
})
