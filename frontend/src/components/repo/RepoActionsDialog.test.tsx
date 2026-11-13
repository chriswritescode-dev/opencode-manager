import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { RepoActionsContent, RepoActionsDialog } from './RepoActionsDialog'
import { renderWithProviders, type TestRenderResult } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'

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

interface ConfigServer {
  routes: FetchRoute[]
  setConfig: (config: ProjectConfigResponse) => void
}

function createConfigServer(initial: ProjectConfigResponse): ConfigServer {
  let current = initial
  const success = (): FetchRouteResult => ({ json: current })
  return {
    routes: [
      { method: 'GET', path: '/api/repos/1/project-config', respond: success },
      { method: 'PUT', path: '/api/repos/1/project-config/actions', respond: success },
      { method: 'PUT', path: '/api/repos/1/project-config/worktree-setup', respond: success },
      { method: 'POST', path: '/api/repos/1/project-config/trust', respond: success },
      { method: 'POST', path: '/api/repos/1/project-config/move', respond: success },
    ],
    setConfig: (config) => {
      current = config
    },
  }
}

async function renderContent(options: {
  config: ProjectConfigResponse
  overrides?: FetchRoute[]
}) {
  installPointerCapture()
  const server = createConfigServer(options.config)
  const view = renderWithProviders(<RepoActionsContent repoId={1} directory="/repo" open />, {
    auth: false,
    theme: false,
    fetchRoutes: [...(options.overrides ?? []), ...server.routes],
  })
  await waitFor(() => expect(view.queryClient.getQueryState(['projectConfig', 1, '/repo'])?.status).toBe('success'))
  return { ...view, server }
}

interface DialogControl {
  setOpen: (open: boolean) => void
  setDirectory: (directory: string) => void
}

function DialogHarness({ control }: { control: DialogControl }) {
  const [open, setOpen] = useState(true)
  const [directory, setDirectory] = useState('/repo')
  control.setOpen = setOpen
  control.setDirectory = setDirectory

  return <RepoActionsDialog repoId={1} directory={directory} open={open} onOpenChange={setOpen} />
}

async function renderDialog(options: {
  config: ProjectConfigResponse
  overrides?: FetchRoute[]
}) {
  installPointerCapture()
  const control: DialogControl = { setOpen: () => undefined, setDirectory: () => undefined }
  const server = createConfigServer(options.config)
  const view = renderWithProviders(<DialogHarness control={control} />, {
    auth: false,
    theme: false,
    fetchRoutes: [...(options.overrides ?? []), ...server.routes],
  })
  await waitFor(() => expect(view.queryClient.getQueryState(['projectConfig', 1, '/repo'])?.status).toBe('success'))
  return { ...view, server, control }
}

async function refetchProjectConfig(queryClient: TestRenderResult['queryClient'], directory = '/repo') {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['projectConfig', 1, directory] })
  })
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
  it('renders the actions content standalone without the dialog shell', async () => {
    const first = await renderContent({ config: baseConfig() })

    expect(screen.getByText('No actions configured')).toBeInTheDocument()
    expect(screen.queryByText('Project Actions')).not.toBeInTheDocument()
    first.unmount()

    await renderContent({
      config: baseConfig({
        actions: [
          { id: 'personal-1', name: 'Dev server', command: 'pnpm dev', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    })

    expect(screen.getByText('Dev server')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /actions/i })).toBeInTheDocument()
    expect(screen.queryByText('Project Actions')).not.toBeInTheDocument()
  })

  it('sends the full personal list when adding an action', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    })

    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Name'), 'Dev server')
    await user.type(screen.getByLabelText('Command'), 'pnpm dev')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchFake.lastRequest('PUT', '/api/repos/1/project-config/actions')?.body).toMatchObject({
      actions: [
        { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false },
        { name: 'Dev server', command: 'pnpm dev', autoOpenUrl: false },
      ],
    }))
  })

  it('adds an action when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', { randomUUID: undefined })
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({ config: baseConfig() })

    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Name'), 'Dev server')
    await user.type(screen.getByLabelText('Command'), 'pnpm dev')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchFake.lastRequest('PUT', '/api/repos/1/project-config/actions')).toBeDefined())
    const payload = fetchFake.lastRequest('PUT', '/api/repos/1/project-config/actions')?.body
    expect(payload).toMatchObject({ actions: [{ name: 'Dev server', command: 'pnpm dev' }] })
    expect(payload).toMatchObject({ actions: [{ id: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/) }] })
  })

  it('offers no edit button for repo items but allows moving them to personal settings', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'personal-1', name: 'Personal action', command: 'echo personal', autoOpenUrl: false, source: 'personal' },
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
      }),
    })

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
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'repo-1', name: 'Repo action', command: 'echo repo', autoOpenUrl: false, source: 'repo' },
        ],
      }),
    })

    const menu = await openRowMenu(user, 'Actions for Repo action')
    await user.click(within(menu).getByRole('menuitem', { name: /move to my settings/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/project-config/move')?.body).toEqual({
        kind: 'action',
        id: 'repo-1',
        to: 'personal',
        directory: '/repo',
      }),
    )
  })

  it('shows the trust banner for an untrusted repo file and sends the displayed hash', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({
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
            actions: [{ id: 'repo-1', name: 'Repo action', command: 'echo repo', url: null, autoOpenUrl: false }],
            setup: [],
          },
        },
      }),
    })

    expect(screen.getByText(/not trusted/i)).toBeInTheDocument()
    const review = await openTrustReview(user)
    await user.click(within(review).getByRole('button', { name: /trust these commands/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/project-config/trust')?.body).toEqual({
        hash: HASH,
        directory: '/repo',
      }),
    )
  })

  it('lists every executable action and setup command, including shadowed actions', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
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
            actions: [{ id: 'shared', name: 'Repo action', command: 'echo repo', url: 'https://example.com', autoOpenUrl: true }],
            setup: ['pnpm install'],
            environment: 'e2e',
            env: { OPENAI_API_KEY: '${{ secrets.OPENAI_API_KEY }}' },
          },
        },
      }),
    })

    const review = await openTrustReview(user)
    expect(within(review).getByText('Actions')).toBeInTheDocument()
    expect(within(review).getByText('Repo action')).toBeInTheDocument()
    expect(within(review).getByText('echo repo')).toBeInTheDocument()
    expect(within(review).getByText('https://example.com')).toBeInTheDocument()
    expect(within(review).getByText('Opens URL automatically')).toBeInTheDocument()
    expect(within(review).getByText('Environment variables')).toBeInTheDocument()
    expect(within(review).getByText('e2e')).toBeInTheDocument()
    expect(within(review).getByText('OPENAI_API_KEY = ${{ secrets.OPENAI_API_KEY }}')).toBeInTheDocument()
    expect(within(review).getByText('Worktree setup commands')).toBeInTheDocument()
    expect(within(review).getByText('pnpm install')).toBeInTheDocument()
  })

  it.each([
    {
      title: 'an environment mapping',
      executable: { actions: [], setup: [], env: { OPENAI_API_KEY: '${{ secrets.OPENAI_API_KEY }}' } },
      expected: 'OPENAI_API_KEY = ${{ secrets.OPENAI_API_KEY }}',
    },
    {
      title: 'an environment name',
      executable: { actions: [], setup: [], environment: 'e2e' },
      expected: 'e2e',
    },
  ])('offers trust when the only executable content is $title', async ({ executable, expected }) => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
        repoFile: {
          path: '.ocm/project.json',
          exists: true,
          trusted: false,
          hash: HASH,
          warnings: [],
          executable,
        },
      }),
    })

    expect(screen.getByText(/not trusted/i)).toBeInTheDocument()
    const review = await openTrustReview(user)
    expect(within(review).getByText('Environment variables')).toBeInTheDocument()
    expect(within(review).getByText(expected)).toBeInTheDocument()
  })

  it.each([
    { title: 'has no content', executable: { actions: [], setup: [] } },
    { title: 'is null', executable: null },
  ])('does not offer trust when the executable snapshot $title', async ({ executable }) => {
    await renderDialog({
      config: baseConfig({
        repoFile: { path: '.ocm/project.json', exists: true, trusted: false, hash: HASH, warnings: [], executable },
      }),
    })

    expect(screen.queryByText(/not trusted/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument()
  })

  it('uses the shared action icon map', async () => {
    const { container } = await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'deploy', name: 'Deploy', command: 'pnpm deploy', icon: 'rocket', autoOpenUrl: false, source: 'personal' },
        ],
      }),
    })

    expect(container.ownerDocument.querySelector('.lucide-rocket')).not.toBeNull()
  })

  it('hides the trust banner for a trusted repo file', async () => {
    await renderDialog({
      config: baseConfig({
        repoFile: { path: '.ocm/project.json', exists: true, trusted: true, hash: HASH, warnings: [], executable: null },
      }),
    })

    expect(screen.queryByText(/not trusted/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument()
  })

  it('renders repository config parse errors', async () => {
    await renderDialog({
      config: baseConfig({
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
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid repository config')
  })

  it('moves a saved personal setup command to the repository', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })

    await openSetupTab(user)
    const menu = await openRowMenu(user, 'Actions for setup command 1')
    await user.click(within(menu).getByRole('menuitem', { name: /move to repository/i }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/repos/1/project-config/move')?.body).toEqual({
        kind: 'setup',
        command: 'pnpm install',
        to: 'repo',
        directory: '/repo',
      }),
    )
  })

  it('disables moving a personal setup command while edits are unsaved', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })

    await openSetupTab(user)
    let menu = await openRowMenu(user, 'Actions for setup command 1')
    expect(within(menu).getByRole('menuitem', { name: /move to repository/i })).not.toHaveAttribute('aria-disabled')
    await closeRowMenu(user)

    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')
    await user.tab()

    menu = await openRowMenu(user, 'Actions for setup command 1')
    expect(within(menu).getByRole('menuitem', { name: /move to repository/i })).toHaveAttribute('aria-disabled', 'true')
    await closeRowMenu(user)
    expect(fetchFake.findRequests('POST', '/api/repos/1/project-config/move')).toHaveLength(0)
  })

  it('enables saving setup only after an edit and pins the save button outside the scrolling list', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })

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
    await waitFor(() => expect(fetchFake.lastRequest('PUT', '/api/repos/1/project-config/worktree-setup')?.body).toEqual({
      commands: ['pnpm install', 'pnpm build'],
    }))
  })

  it('reports a failed action save and keeps the draft', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
      }),
      overrides: [
        { method: 'PUT', path: '/api/repos/1/project-config/actions', respond: () => ({ status: 400, json: { error: 'Server rejected the action' } }) },
      ],
    })

    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Name'), 'Dev server')
    await user.type(screen.getByLabelText('Command'), 'pnpm dev')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Server rejected the action')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Dev server')
    expect(screen.getByLabelText('Command')).toHaveValue('pnpm dev')
  })

  it('reports a failed setup save and keeps edits', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
      overrides: [
        { method: 'PUT', path: '/api/repos/1/project-config/worktree-setup', respond: () => ({ status: 400, json: { error: 'Setup save rejected' } }) },
      ],
    })

    await openSetupTab(user)
    const input = screen.getByLabelText('Setup command 1')
    await user.clear(input)
    await user.type(input, 'pnpm ci')
    await user.click(screen.getByRole('button', { name: /save setup/i }))

    expect(await screen.findByText('Setup save rejected')).toBeInTheDocument()
    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci')
  })

  it('reports a failed trust attempt', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
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
            actions: [{ id: 'repo-1', name: 'Repo action', command: 'echo repo', url: null, autoOpenUrl: false }],
            setup: [],
          },
        },
      }),
      overrides: [
        { method: 'POST', path: '/api/repos/1/project-config/trust', respond: () => ({ status: 400, json: { error: 'Trust rejected' } }) },
      ],
    })

    const review = await openTrustReview(user)
    await user.click(within(review).getByRole('button', { name: /trust these commands/i }))

    expect(await screen.findByText('Trust rejected')).toBeInTheDocument()
  })

  it('reports a failed move', async () => {
    const user = userEvent.setup()
    await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'personal-1', name: 'Personal action', command: 'echo personal', autoOpenUrl: false, source: 'personal' },
        ],
      }),
      overrides: [
        { method: 'POST', path: '/api/repos/1/project-config/move', respond: () => ({ status: 400, json: { error: 'Move rejected' } }) },
      ],
    })

    const menu = await openRowMenu(user, 'Actions for Personal action')
    await user.click(within(menu).getByRole('menuitem', { name: /move to repository/i }))

    expect(await screen.findByText('Move rejected')).toBeInTheDocument()
  })

  it('preserves unsaved setup edits when unrelated config data refetches', async () => {
    const user = userEvent.setup()
    const { server, queryClient } = await renderDialog({
      config: baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
        ],
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
      }),
    })

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    server.setConfig(
      baseConfig({
        actions: [
          { id: 'existing', name: 'Existing', command: 'echo hi', autoOpenUrl: false, source: 'personal' },
          { id: 'added', name: 'Added', command: 'pnpm dev', autoOpenUrl: false, source: 'personal' },
        ],
        worktreeSetup: [{ command: 'pnpm install', source: 'personal' }],
        repoFile: { path: '.ocm/project.json', exists: true, trusted: true, hash: HASH, warnings: [], executable: null },
      }),
    )
    await refetchProjectConfig(queryClient)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm install --frozen-lockfile')
  })

  it('reflects persisted setup commands after a setup operation', async () => {
    const user = userEvent.setup()
    const { server, queryClient } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })
    await openSetupTab(user)

    server.setConfig(baseConfig({ worktreeSetup: [{ command: 'pnpm ci', source: 'personal' }] }))
    await refetchProjectConfig(queryClient)

    await waitFor(() => expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci'))
  })

  it('reinitializes setup commands from persisted data when the dialog reopens', async () => {
    const user = userEvent.setup()
    const { control } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    act(() => control.setOpen(false))
    act(() => control.setOpen(true))
    await openSetupTab(user)

    expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm install')
  })

  it('reinitializes setup commands when the location changes', async () => {
    const user = userEvent.setup()
    const { server, control, queryClient } = await renderDialog({
      config: baseConfig({ worktreeSetup: [{ command: 'pnpm install', source: 'personal' }] }),
    })

    await openSetupTab(user)
    await user.type(screen.getByLabelText('Setup command 1'), ' --frozen-lockfile')

    server.setConfig(baseConfig({ worktreeSetup: [{ command: 'pnpm ci', source: 'personal' }] }))
    act(() => control.setDirectory('/repo-worktree'))

    await waitFor(() => expect(queryClient.getQueryState(['projectConfig', 1, '/repo-worktree'])?.status).toBe('success'))
    await openSetupTab(user)
    await waitFor(() => expect(screen.getByLabelText('Setup command 1')).toHaveValue('pnpm ci'))
  })
})
