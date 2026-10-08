import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { FetchError } from '@opencode-manager/shared'
import { RepoActionsContent, RepoActionsDialog } from './RepoActionsDialog'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'

const mocks = vi.hoisted(() => ({
  useProjectConfig: vi.fn(),
  updateActionsMutate: vi.fn(),
  updateSetupMutate: vi.fn(),
  trustMutate: vi.fn(),
  moveMutate: vi.fn(),
  showToastError: vi.fn(),
}))

vi.mock('@/api/projectConfig', () => ({
  useProjectConfig: mocks.useProjectConfig,
  useUpdateProjectActions: () => ({ mutate: mocks.updateActionsMutate, isPending: false }),
  useUpdateWorktreeSetup: () => ({ mutate: mocks.updateSetupMutate, isPending: false }),
  useTrustRepoConfig: () => ({ mutate: mocks.trustMutate, isPending: false }),
  useMoveProjectItem: () => ({ mutate: mocks.moveMutate, isPending: false }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: mocks.showToastError, success: vi.fn() },
}))

const HASH = 'a'.repeat(64)

function baseConfig(overrides: Partial<ProjectConfigResponse> = {}): ProjectConfigResponse {
  return {
    actions: [],
    worktreeSetup: [],
    repoFile: {
      path: '.ocm/project.json',
      exists: false,
      trusted: false,
      hash: null,
      warnings: [],
      executable: null,
    },
    ...overrides,
  }
}

function mockConfig(config: ProjectConfigResponse) {
  mocks.useProjectConfig.mockReturnValue({ data: config, isLoading: false, error: null })
}

function renderDialog() {
  return render(
    <RepoActionsDialog repoId={1} directory="/repo" open onOpenChange={vi.fn()} />,
  )
}

async function openSetupTab(user: UserEvent) {
  await user.click(screen.getByRole('tab', { name: /worktree setup/i }))
}

async function openRowMenu(user: UserEvent, label: string) {
  await user.click(screen.getByRole('button', { name: label }))
  return screen.findByRole('menu')
}

async function closeRowMenu(user: UserEvent) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
}

async function openTrustReview(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^review$/i }))
  return screen.findByRole('dialog', { name: /trust repository commands/i })
}

describe('RepoActionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the actions content standalone without the dialog shell', () => {
    mockConfig(baseConfig())
    const view = render(<RepoActionsContent repoId={1} directory="/repo" open />)

    expect(screen.getByText('No actions configured')).toBeInTheDocument()
    expect(screen.queryByText('Project Actions')).not.toBeInTheDocument()

    mockConfig(
      baseConfig({
        actions: [
          { id: 'personal-1', name: 'Dev server', command: 'pnpm dev', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    )
    view.rerender(<RepoActionsContent repoId={1} directory="/repo" open />)

    expect(screen.getByText('Dev server')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /actions/i })).toBeInTheDocument()
    expect(screen.queryByText('Project Actions')).not.toBeInTheDocument()
  })

  it('sends the full personal list when adding an action', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Name'), 'Dev server')
    await user.type(screen.getByLabelText('Command'), 'pnpm dev')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mocks.updateActionsMutate).toHaveBeenCalledTimes(1))
    const payload = mocks.updateActionsMutate.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({ id: 'existing', name: 'Existing', command: 'echo hi' })
    expect(payload[1]).toMatchObject({ name: 'Dev server', command: 'pnpm dev' })
  })

  it('adds an action when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', { randomUUID: undefined })
    try {
      mockConfig(baseConfig())
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: /add action/i }))
      await user.type(screen.getByLabelText('Name'), 'Dev server')
      await user.type(screen.getByLabelText('Command'), 'pnpm dev')
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => expect(mocks.updateActionsMutate).toHaveBeenCalledTimes(1))
      const payload = mocks.updateActionsMutate.mock.calls[0][0]
      expect(payload).toHaveLength(1)
      expect(payload[0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      expect(payload[0]).toMatchObject({ name: 'Dev server', command: 'pnpm dev' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('offers no edit button for repo items but allows moving them to personal settings', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'personal-1', name: 'Personal action', command: 'echo personal', autoOpenUrl: false, source: 'personal' },
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(1)
    expect(screen.getByText('In repo')).toBeInTheDocument()

    const repoMenu = await openRowMenu(user, 'Actions for Repo action')
    expect(within(repoMenu).getByRole('menuitem', { name: /move to my settings/i })).toBeInTheDocument()
    expect(within(repoMenu).queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument()
    await closeRowMenu(user)

    const personalMenu = await openRowMenu(user, 'Actions for Personal action')
    expect(within(personalMenu).getByRole('menuitem', { name: /move to repository/i })).toBeInTheDocument()
    expect(within(personalMenu).getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
  })

  it('moves a repo action to personal settings from its row menu', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    const menu = await openRowMenu(user, 'Actions for Repo action')
    await user.click(within(menu).getByRole('menuitem', { name: /move to my settings/i }))

    await waitFor(() => expect(mocks.moveMutate).toHaveBeenCalledTimes(1))
    expect(mocks.moveMutate.mock.calls[0][0]).toEqual({ kind: 'action', id: 'repo-1', to: 'personal', directory: '/repo' })
  })

  it('shows the trust banner for an untrusted repo file and sends the displayed hash', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: false,
          hash: HASH,
          warnings: [],
          executable: {
            actions: [
              { id: 'repo-1', name: 'Repo action', command: 'echo repo', url: null, autoOpenUrl: false },
            ],
            setup: [],
          },
        },
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    expect(screen.getByText(/not trusted/i)).toBeInTheDocument()
    const review = await openTrustReview(user)
    await user.click(within(review).getByRole('button', { name: /trust these commands/i }))

    expect(mocks.trustMutate.mock.calls[0][0]).toEqual({ hash: HASH, directory: '/repo' })
  })

  it('lists every executable action and setup command, including shadowed actions', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'shared', name: 'My action', command: 'echo personal', autoOpenUrl: false, source: 'personal' },
        ],
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: false,
          hash: HASH,
          warnings: [],
          executable: {
            actions: [
              { id: 'shared', name: 'Repo action', command: 'echo repo', url: 'https://example.com', autoOpenUrl: true },
            ],
            setup: ['pnpm install'],
          },
        },
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    const review = await openTrustReview(user)
    expect(within(review).getByText('Actions')).toBeInTheDocument()
    expect(within(review).getByText('Repo action')).toBeInTheDocument()
    expect(within(review).getByText('echo repo')).toBeInTheDocument()
    expect(within(review).getByText('https://example.com')).toBeInTheDocument()
    expect(within(review).getByText('Opens URL automatically')).toBeInTheDocument()
    expect(within(review).getByText('Worktree setup commands')).toBeInTheDocument()
    expect(within(review).getByText('pnpm install')).toBeInTheDocument()
  })

  it('does not offer trust when the repo file has no executable commands', () => {
    mockConfig(
      baseConfig({
        repoFile: { path: '.ocm/project.json', exists: true, trusted: false, hash: HASH, warnings: [], executable: null },
      }),
    )
    renderDialog()

    expect(screen.queryByText(/not trusted/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument()
  })

  it('uses the shared action icon map', () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'deploy', name: 'Deploy', command: 'pnpm deploy', icon: 'rocket', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    )
    const { container } = renderDialog()

    expect(container.ownerDocument.querySelector('.lucide-rocket')).not.toBeNull()
  })

  it('hides the trust banner for a trusted repo file', () => {
    mockConfig(
      baseConfig({
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: true,
          hash: HASH,
          warnings: [],
          executable: null,
        },
      }),
    )
    renderDialog()

    expect(screen.queryByText(/not trusted/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument()
  })

  it('renders repository config parse errors', () => {
    mockConfig(
      baseConfig({
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: false,
          hash: null,
          error: 'Invalid repository config',
          warnings: [],
          executable: null,
        },
      }),
    )
    renderDialog()

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid repository config')
  })

  it('moves a saved personal setup command to the repository', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    await openSetupTab(user)
    const menu = await openRowMenu(user, 'Actions for setup command 1')
    await user.click(within(menu).getByRole('menuitem', { name: /move to repository/i }))

    await waitFor(() => expect(mocks.moveMutate).toHaveBeenCalledTimes(1))
    expect(mocks.moveMutate.mock.calls[0][0]).toEqual({
      kind: 'setup',
      command: 'pnpm install',
      to: 'repo',
      directory: '/repo',
    })
  })

  it('disables moving a personal setup command while edits are unsaved', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    await openSetupTab(user)
    let menu = await openRowMenu(user, 'Actions for setup command 1')
    expect(within(menu).getByRole('menuitem', { name: /move to repository/i })).not.toHaveAttribute('aria-disabled')
    await closeRowMenu(user)

    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')
    await user.tab()

    menu = await openRowMenu(user, 'Actions for setup command 1')
    expect(within(menu).getByRole('menuitem', { name: /move to repository/i })).toHaveAttribute('aria-disabled', 'true')
    await closeRowMenu(user)
    expect(mocks.moveMutate).not.toHaveBeenCalled()
  })

  it('enables saving setup only after an edit and pins the save button outside the scrolling list', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    await openSetupTab(user)
    const save = screen.getByRole('button', { name: /save setup/i })
    expect(save).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add command/i }))
    expect(screen.getByLabelText('Setup command 2')).toHaveFocus()
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText('Setup command 2'), 'pnpm build')
    expect(save).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(save.closest('.overflow-y-auto')).toBeNull()

    await user.click(save)
    expect(mocks.updateSetupMutate.mock.calls[0][0]).toEqual(['pnpm install', 'pnpm build'])
  })

  it('reports a failed action save and keeps the draft', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    )
    mocks.updateActionsMutate.mockImplementation(
      (_payload: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new FetchError('Server rejected the action', 400))
      },
    )
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Name'), 'Dev server')
    await user.type(screen.getByLabelText('Command'), 'pnpm dev')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mocks.showToastError).toHaveBeenCalledWith('Server rejected the action')
    expect(screen.getByLabelText('Name')).toHaveValue('Dev server')
    expect(screen.getByLabelText('Command')).toHaveValue('pnpm dev')
  })

  it('reports a failed setup save and keeps edits', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    mocks.updateSetupMutate.mockImplementation(
      (_commands: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new FetchError('Setup save rejected', 400))
      },
    )
    const user = userEvent.setup()
    renderDialog()

    await openSetupTab(user)
    const input = screen.getByLabelText('Setup command 1')
    await user.clear(input)
    await user.type(input, 'pnpm ci')
    await user.click(screen.getByRole('button', { name: /save setup/i }))

    expect(mocks.showToastError).toHaveBeenCalledWith('Setup save rejected')
    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci')
  })

  it('reports a failed trust attempt', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: false,
          hash: HASH,
          warnings: [],
          executable: {
            actions: [
              { id: 'repo-1', name: 'Repo action', command: 'echo repo', url: null, autoOpenUrl: false },
            ],
            setup: [],
          },
        },
      }),
    )
    mocks.trustMutate.mockImplementation(
      (_request: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new FetchError('Trust rejected', 400))
      },
    )
    const user = userEvent.setup()
    renderDialog()

    const review = await openTrustReview(user)
    await user.click(within(review).getByRole('button', { name: /trust these commands/i }))

    expect(mocks.showToastError).toHaveBeenCalledWith('Trust rejected')
  })

  it('reports a failed move', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'personal-1', name: 'Personal action', command: 'echo personal', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    )
    mocks.moveMutate.mockImplementation(
      (_request: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new FetchError('Move rejected', 400))
      },
    )
    const user = userEvent.setup()
    renderDialog()

    const menu = await openRowMenu(user, 'Actions for Personal action')
    await user.click(within(menu).getByRole('menuitem', { name: /move to repository/i }))

    await waitFor(() => expect(mocks.showToastError).toHaveBeenCalledWith('Move rejected'))
  })

  it('preserves unsaved setup edits when unrelated config data refetches', async () => {
    mockConfig(
      baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    const view = renderDialog()

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    mockConfig(
      baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
          { id: 'added', name: 'Added', command: 'pnpm dev', autoOpenUrl: false, source: 'personal' },
        ],
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
        repoFile: { path: '.ocm/project.json', exists: true, trusted: true, hash: HASH, warnings: [], executable: null },
      }),
    )
    view.rerender(<RepoActionsDialog repoId={1} directory="/repo" open onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm install --frozen-lockfile')
  })

  it('reflects persisted setup commands after a setup operation', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    const view = renderDialog()
    await openSetupTab(user)

    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm ci', source: 'personal' }],
      }),
    )
    view.rerender(<RepoActionsDialog repoId={1} directory="/repo" open onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci')
  })

  it('reinitializes setup commands from persisted data when the dialog reopens', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    const view = renderDialog()

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    view.rerender(<RepoActionsDialog repoId={1} directory="/repo" open={false} onOpenChange={vi.fn()} />)
    view.rerender(<RepoActionsDialog repoId={1} directory="/repo" open onOpenChange={vi.fn()} />)
    await openSetupTab(user)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm install')
  })

  it('reinitializes setup commands when the location changes', async () => {
    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    )
    const user = userEvent.setup()
    const view = renderDialog()

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    mockConfig(
      baseConfig({
        worktreeSetup: [{ command: 'pnpm ci', source: 'personal' }],
      }),
    )
    view.rerender(<RepoActionsDialog repoId={1} directory="/repo-worktree" open onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci')
  })
})
