import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchesTab } from './BranchesTab'
import { renderWithProviders } from '@/test/render'
import { makeRepo } from '@/test/fixtures/api'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

const branches = [
  { name: 'main', type: 'local' as const, current: true },
  { name: 'feature', type: 'local' as const, current: false },
]

interface BranchesRenderOptions {
  branchList?: typeof branches
}

function renderBranches({ branchList = branches }: BranchesRenderOptions = {}) {
  installPointerCapture()
  const fetchRoutes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/repos/1/git/branches',
      respond: () => ({ json: { branches: branchList, status: { ahead: 0, behind: 0 } } }),
    },
    {
      method: 'GET',
      path: '/api/repos/1',
      respond: () => ({ json: makeRepo({ id: 1, repoUrl: 'https://example.com/org/repo.git' }) }),
    },
    {
      method: 'POST',
      path: '/api/repos/1/branch/switch',
      respond: () => ({ json: makeRepo({ id: 1, currentBranch: 'feature' }) }),
    },
    {
      method: 'GET',
      path: '/api/repos/1/git/status',
      respond: () => ({
        json: { branch: 'feature', ahead: 0, behind: 0, files: [], hasChanges: false, operation: null },
      }),
    },
  ]
  return renderWithProviders(<BranchesTab repoId={1} currentBranch="main" />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
}

describe('BranchesTab', () => {
  it('gives the inline rename textbox a descriptive accessible name', async () => {
    const user = userEvent.setup()
    renderBranches()

    await user.click(await screen.findByRole('button', { name: 'Actions for feature' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    expect(screen.getByRole('textbox', { name: 'New name for branch feature' })).toBeInTheDocument()
  })

  it('shows the upstream branch name in the delete dialog', async () => {
    const user = userEvent.setup()
    renderBranches({
      branchList: [
        { name: 'main', type: 'local', current: true },
        { name: 'feature', type: 'local', current: false, upstream: 'origin/feature' },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Actions for feature' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('origin/feature')).toBeInTheDocument()
  })

  it('switches the checked-out branch and confirms it', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBranches()

    await user.click(await screen.findByRole('button', { name: /^feature/ }))

    expect(fetchFake.lastRequest('POST', '/api/repos/1/branch/switch')?.body).toEqual({
      branch: 'feature',
    })
    expect(await screen.findByText('Switched to branch: feature')).toBeInTheDocument()
  })
})
