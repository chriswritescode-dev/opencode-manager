import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { ProjectHubOverflowMenu } from './ProjectHubOverflowMenu'

const mocks = vi.hoisted(() => ({
  useProjectConfig: vi.fn(),
  useTerminals: vi.fn(),
  getProjectConfig: vi.fn(),
  runMutate: vi.fn(),
  removeMutate: vi.fn(),
  trustMutate: vi.fn(),
}))

vi.mock('@/api/projectConfig', () => ({
  getProjectConfig: mocks.getProjectConfig,
  useProjectConfig: mocks.useProjectConfig,
  useRunProjectAction: () => ({ mutate: mocks.runMutate, isPending: false }),
  useTrustRepoConfig: () => ({ mutate: mocks.trustMutate, isPending: false }),
}))

vi.mock('@/api/terminals', () => ({
  useTerminals: mocks.useTerminals,
  useRemoveTerminal: () => ({ mutate: mocks.removeMutate, isPending: false }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/components/repo/MultiRunSheet', () => ({
  MultiRunSheet: ({
    target,
    directory,
    open,
  }: {
    target: { kind: string; serverId?: string; directory?: string }
    directory?: string
    open: boolean
  }) => (
    <div
      data-testid="multi-run-sheet"
      data-open={String(open)}
      data-kind={target.kind}
      data-server={target.serverId}
      data-target-directory={target.directory}
      data-directory={directory}
    />
  ),
}))

vi.mock('@/components/schedules/ServerSchedulesContent', () => ({
  ServerSchedulesContent: ({ target }: { target: { serverId: string; directory: string } }) => (
    <div
      data-testid="server-schedules-content"
      data-server={target.serverId}
      data-directory={target.directory}
    />
  ),
}))

function makeConfig(actions: ProjectConfigResponse['actions']): ProjectConfigResponse {
  return {
    actions,
    worktreeSetup: [],
    repoFile: {
      path: '.ocm/project.json',
      exists: false,
      trusted: true,
      hash: null,
      warnings: [],
      executable: null,
    },
  }
}

const devAction: ProjectConfigResponse['actions'][number] = {
  id: 'dev',
  name: 'Dev server',
  command: 'pnpm dev',
  autoOpenUrl: false,
  source: 'personal',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderMenu(onCreateWorktree = vi.fn(), repoId = 1) {
  const rendered = render(
    <MemoryRouter initialEntries={[`/?menu=sessions&menuProject=repo:${repoId}`]}>
      <LocationProbe />
      <ProjectHubOverflowMenu
        target={{ kind: 'repo', repoId }}
        directory="/abs/repos/one"
        onCreateWorktree={onCreateWorktree}
      />
    </MemoryRouter>,
  )
  return { ...rendered, onCreateWorktree }
}

const serverDirectory = '/abs/server/app'

function renderServerMenu() {
  const encodedTarget = `server:srv_kitchen:${encodeURIComponent(serverDirectory)}`
  return render(
    <MemoryRouter initialEntries={[`/?menu=sessions&menuProject=${encodedTarget}`]}>
      <LocationProbe />
      <ProjectHubOverflowMenu
        target={{ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory }}
        directory={serverDirectory}
      />
    </MemoryRouter>,
  )
}

function currentParams(): URLSearchParams {
  const location = screen.getByTestId('location').textContent ?? ''
  return new URLSearchParams(location.split('?')[1] ?? '')
}

describe('ProjectHubOverflowMenu', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([]) })
    mocks.useTerminals.mockReturnValue({ data: [] })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([]))
  })

  it('lists project actions, worktree creation and the repo tools', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByText('No actions configured')).toBeInTheDocument()
    for (const name of ['Multi-run', 'Create worktree', 'MCP', 'Skills', 'Secrets', 'Terminal', 'Preview', 'Schedules', 'Reset Permissions']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
  })

  it('keeps the repo tool set for the assistant repo', async () => {
    const user = userEvent.setup()
    renderMenu(vi.fn(), ASSISTANT_REPO_ID)

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Manage actions…',
      'Multi-run',
      'Create worktree',
      'MCP',
      'Skills',
      'Secrets',
      'Terminal',
      'Preview',
      'Schedules',
      'Reset Permissions',
    ])
  })

  it('opens the multi-run dialog scoped to the repo project', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Multi-run' }))

    await waitFor(() => {
      const params = currentParams()
      expect(params.get('dialog')).toBe('multiRun')
      expect(params.get('toolProject')).toBe('repo:1')
      expect(params.has('menu')).toBe(false)
      expect(params.has('menuProject')).toBe(false)
    })
  })

  it('opens the MCP dialog scoped to the repo project', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'MCP' }))

    await waitFor(() => {
      const params = currentParams()
      expect(params.get('dialog')).toBe('mcp')
      expect(params.get('toolProject')).toBe('repo:1')
      expect(params.has('menu')).toBe(false)
      expect(params.has('menuProject')).toBe(false)
    })
  })

  it('asks the hub to create a worktree', async () => {
    const user = userEvent.setup()
    const { onCreateWorktree } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Create worktree' }))

    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
  })

  it('navigates to the repo schedules', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Schedules' }))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('/repos/1/schedules')
    })
    expect(screen.getByTestId('location').textContent).toContain('returnTo=')
  })

  it('opens the actions dialog scoped to the repo project', async () => {
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig([devAction]) })
    mocks.getProjectConfig.mockResolvedValue(makeConfig([devAction]))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    expect(await screen.findByRole('menuitem', { name: /dev server/i })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /manage actions/i }))

    await waitFor(() => {
      const params = currentParams()
      expect(params.get('dialog')).toBe('actions')
      expect(params.get('toolProject')).toBe('repo:1')
    })
  })

  it('lists only the linked-server project tools', async () => {
    const user = userEvent.setup()
    renderServerMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Schedules',
      'Multi-run',
      'MCP',
      'Skills',
      'Git',
      'Terminal',
    ])
    for (const name of ['Secrets', 'Preview', 'Reset Permissions', 'Create worktree']) {
      expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByText('No actions configured')).not.toBeInTheDocument()
  })

  it('opens the MCP dialog scoped to the linked-server project', async () => {
    const user = userEvent.setup()
    renderServerMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'MCP' }))

    await waitFor(() => {
      const params = currentParams()
      expect(params.get('dialog')).toBe('mcp')
      expect(params.get('toolProject')).toBe('server:srv_kitchen:%2Fabs%2Fserver%2Fapp')
      expect(params.has('menu')).toBe(false)
      expect(params.has('menuProject')).toBe(false)
    })
  })

  it('opens the schedules dialog for the linked-server directory', async () => {
    const user = userEvent.setup()
    renderServerMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Schedules' }))

    const content = await screen.findByTestId('server-schedules-content')
    expect(content).toHaveAttribute('data-server', 'srv_kitchen')
    expect(content).toHaveAttribute('data-directory', serverDirectory)
  })

  it('opens the multi-run sheet scoped to the linked-server directory', async () => {
    const user = userEvent.setup()
    renderServerMenu()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Multi-run' }))

    const sheet = await screen.findByTestId('multi-run-sheet')
    expect(sheet).toHaveAttribute('data-open', 'true')
    expect(sheet).toHaveAttribute('data-kind', 'server')
    expect(sheet).toHaveAttribute('data-server', 'srv_kitchen')
    expect(sheet).toHaveAttribute('data-target-directory', serverDirectory)
    expect(sheet).toHaveAttribute('data-directory', serverDirectory)
  })
})
