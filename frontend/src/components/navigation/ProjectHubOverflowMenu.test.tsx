import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'
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

function renderMenu(onCreateWorktree = vi.fn()) {
  const rendered = render(
    <MemoryRouter initialEntries={['/?menu=sessions&menuProject=repo:1']}>
      <LocationProbe />
      <ProjectHubOverflowMenu repoId={1} directory="/abs/repos/one" onCreateWorktree={onCreateWorktree} />
    </MemoryRouter>,
  )
  return { ...rendered, onCreateWorktree }
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
})
