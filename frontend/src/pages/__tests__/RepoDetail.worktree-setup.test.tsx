import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeRepo } from '@/test/fixtures/api'
import { renderRepoDetailPage } from '@/test/repoPage'
import { installMatchMedia } from '@/test/browserFakes'

const baseRepo = makeRepo({
  id: 1,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
})

const newWorkspaceDirectory = '/abs/repos/demo-ws'

const setupTerminal = {
  id: 'pty-new',
  title: 'Worktree setup',
  kind: 'setup',
  cwd: newWorkspaceDirectory,
  status: 'running',
}

describe('RepoDetail worktree setup', () => {
  beforeEach(() => {
    installMatchMedia(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 780 })
  })

  it('switches to the new workspace terminal when setup starts from the repo tab', async () => {
    const { capturedSearch } = renderRepoDetailPage({
      repo: baseRepo,
      createWorkspaceRespond: () => ({
        json: {
          directory: newWorkspaceDirectory,
          worktreeSetup: { status: 'started', terminal: setupTerminal, repoCommandsSkipped: false },
        },
      }),
      sessions: () => [],
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Worktree' }))
    await user.click(await screen.findByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => {
      expect(capturedSearch.current).toContain('repoTab=workspaces')
    })
    expect(capturedSearch.current).toContain('terminal=pty-new')
    expect(capturedSearch.current).toContain(
      `terminalDirectory=${encodeURIComponent(newWorkspaceDirectory)}`,
    )
  })

  it('stays on the workspace tab without a terminal when setup does not start', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderRepoDetailPage({
      repo: baseRepo,
      createWorkspaceRespond: () => ({
        json: { directory: newWorkspaceDirectory, worktreeSetup: { status: 'none' } },
      }),
      sessions: () => [],
    })

    await user.click(await screen.findByRole('button', { name: 'Worktree' }))
    await user.click(await screen.findByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => {
      expect(capturedSearch.current).toContain('repoTab=workspaces')
    })
    expect(capturedSearch.current).not.toContain('terminal=')
    expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument()
  })

  it('sends the typed worktree name and blocks names that are not a single folder', async () => {
    const { fetchFake } = renderRepoDetailPage({
      repo: baseRepo,
      createWorkspaceRespond: () => ({
        json: { directory: newWorkspaceDirectory, worktreeSetup: { status: 'none' } },
      }),
      sessions: () => [],
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Worktree' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create Worktree' })
    const nameInput = within(dialog).getByLabelText('Name')

    await user.type(nameInput, '../escape')
    expect(within(dialog).getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
    expect(screen.getByText('Directory name cannot contain dot-dot path segments')).toBeInTheDocument()

    await user.clear(nameInput)
    await user.type(nameInput, 'feature-login')
    await user.click(within(dialog).getByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', '/api/repos/1/workspaces')?.body).toEqual({
        name: 'feature-login',
      })
    })
  })
})
