import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RemoteProjectList } from '../RemoteProjectList'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listSessionPage: vi.fn(),
  useCreateSession: vi.fn(),
  useOpenCodeServers: vi.fn(),
  useSettingsDialog: vi.fn(),
  openTab: vi.fn(),
  createSession: vi.fn(),
  isMobile: true,
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: mocks.listProjects, listSessionPage: mocks.listSessionPage }
})

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return { ...actual, useCreateSession: mocks.useCreateSession }
})

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: mocks.useSettingsDialog,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: () => mocks.isMobile,
  useSwipeBack: () => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  }),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useProjectActivityState: () => null,
}))

vi.mock('@/components/schedules/ServerSchedulesDialog', () => ({
  ServerSchedulesDialog: ({
    open,
    target,
  }: {
    open: boolean
    target: { serverId: string; directory: string } | null
  }) =>
    open ? (
      <div
        data-testid="schedules-dialog"
        data-server={target?.serverId}
        data-directory={target?.directory}
      />
    ) : null,
}))

vi.mock('@/components/repo/MultiRunSheet', () => ({
  MultiRunSheet: ({
    open,
    target,
    directory,
  }: {
    open: boolean
    target: { kind: string; serverId?: string; directory?: string }
    directory?: string
  }) => (
    <div
      data-testid="multi-run-sheet"
      data-open={String(open)}
      data-kind={target.kind}
      data-server={target.serverId}
      data-directory={directory}
    />
  ),
}))

const server = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const project = {
  id: 'prj_1',
  canonical: '/home/me/app',
  name: 'App',
  vcs: 'git',
  time: { created: Date.now() - 120_000, updated: Date.now() - 60_000, active: 2 },
  sandboxes: [],
}

const otherProject = {
  id: 'prj_2',
  canonical: '/srv/other',
  name: 'Other',
  time: { created: Date.now() - 120_000, updated: Date.now() - 60_000, active: 2 },
  sandboxes: [],
}

function createSession(directory: string, updated: number) {
  return {
    id: `ses_${directory}`,
    projectID: 'prj_1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated - 1000, updated },
    location: { directory },
  }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderProjectList(serverId = 'srv_kitchen', queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RemoteProjectList serverId={serverId} />} />
          <Route path="/servers/:serverId/projects" element={<div data-testid="project-route" />} />
          <Route path="/servers/:serverId/sessions/:sessionId" element={<div data-testid="session-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RemoteProjectList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = true
    mocks.listProjects.mockResolvedValue([project])
    mocks.listSessionPage.mockResolvedValue({ items: [] })
    mocks.useCreateSession.mockReturnValue({ mutateAsync: mocks.createSession, isPending: false })
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [server],
      isLoading: false,
      showsInitialLoading: false,
    })
    mocks.useSettingsDialog.mockReturnValue({ openTab: mocks.openTab })
  })

  it('lists projects from the remote server', async () => {
    renderProjectList()

    await waitFor(() => {
      expect(screen.getByText('App')).toBeInTheDocument()
    })
    expect(screen.getByText('/home/me/app')).toBeInTheDocument()
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
  })

  it('labels a row with its newest session time instead of the project activity time', async () => {
    const now = Date.now()
    mocks.listProjects.mockResolvedValue([
      {
        ...project,
        time: { created: now - 10_800_000, updated: now - 10_800_000, active: now },
      },
    ])
    mocks.listSessionPage.mockResolvedValue({
      items: [createSession('/home/me/app', now - 300_000)],
    })

    renderProjectList()

    await screen.findByText('App')
    expect(await screen.findByText('5m ago')).toBeInTheDocument()
  })

  it('labels a row with the update time when the project has no session in the fetched page', async () => {
    const now = Date.now()
    mocks.listProjects.mockResolvedValue([
      {
        ...project,
        time: { created: now - 10_800_000, updated: now - 300_000, active: now },
      },
    ])

    renderProjectList()

    await screen.findByText('App')
    expect(await screen.findByText('5m ago')).toBeInTheDocument()
  })

  it('orders projects by their newest session, not by the project activity time', async () => {
    const now = Date.now()
    mocks.listProjects.mockResolvedValue([
      {
        ...project,
        time: { created: now - 10_800_000, updated: now - 10_800_000, active: now },
      },
      {
        ...otherProject,
        time: { created: now - 10_800_000, updated: now - 10_800_000, active: now - 3_600_000 },
      },
    ])
    mocks.listSessionPage.mockResolvedValue({
      items: [createSession('/srv/other', now - 120_000)],
    })

    renderProjectList()

    await screen.findByText('App')
    await waitFor(() => {
      expect(screen.getByText('Other')).toBeInTheDocument()
    })
    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(names).toEqual(['Other', 'App'])
  })

  it('shows no status dot on remote project cards', async () => {
    const { container } = renderProjectList()

    await screen.findByText('App')
    expect(container.querySelector('.bg-success')).toBeNull()
  })

  it('opens the remote project page when a project card is clicked', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByText('App'))

    await waitFor(() => {
      expect(screen.getByTestId('project-route')).toBeInTheDocument()
    })
  })

  it('creates a session in a project directory from the actions menu and navigates to it', async () => {
    const user = userEvent.setup()
    mocks.createSession.mockResolvedValue({ id: 'ses_new' })
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /New session/ }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ agent: undefined })
    })
    await waitFor(() => {
      expect(screen.getByTestId('session-route')).toBeInTheDocument()
    })
  })

  it('opens the project schedules from the actions menu', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Schedules/ }))

    const dialog = await screen.findByTestId('schedules-dialog')
    expect(dialog).toHaveAttribute('data-server', 'srv_kitchen')
    expect(dialog).toHaveAttribute('data-directory', '/home/me/app')

    await user.click(dialog)
    expect(screen.queryByTestId('project-route')).not.toBeInTheDocument()
    expect(screen.getByTestId('schedules-dialog')).toBeInTheDocument()
  })

  it('opens multi-run for the project from the actions menu', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Multi-run/ }))

    const sheet = await screen.findByTestId('multi-run-sheet')
    expect(sheet).toHaveAttribute('data-open', 'true')
    expect(sheet).toHaveAttribute('data-kind', 'server')
    expect(sheet).toHaveAttribute('data-server', 'srv_kitchen')
    expect(sheet).toHaveAttribute('data-directory', '/home/me/app')
  })

  it('shows inline project actions on desktop without opening the project', async () => {
    const user = userEvent.setup()
    mocks.isMobile = false
    renderProjectList()

    await screen.findByText('App')
    expect(screen.queryByRole('button', { name: 'Project actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Multi-run' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Schedules' }))

    expect(await screen.findByTestId('schedules-dialog')).toHaveAttribute('data-directory', '/home/me/app')
    expect(screen.queryByTestId('project-route')).not.toBeInTheDocument()
  })

  it('opens a session in an arbitrary directory from the dialog', async () => {
    const user = userEvent.setup()
    mocks.createSession.mockResolvedValue({ id: 'ses_other' })
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Open directory' }))
    await user.type(screen.getByLabelText('Directory'), '/srv/other')
    await user.click(screen.getByRole('button', { name: /Start session/ }))

    await waitFor(() => {
      expect(mocks.useCreateSession).toHaveBeenCalledWith('/srv/other')
    })
    expect(mocks.createSession).toHaveBeenCalledWith({ agent: undefined })
    await waitFor(() => {
      expect(screen.getByTestId('session-route')).toBeInTheDocument()
    })
  })

  it('does not render the open-directory form in the list until the dialog opens', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await screen.findByText('App')
    expect(screen.queryByLabelText('Directory')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('/absolute/path/on/the/server')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open directory' }))

    expect(await screen.findByLabelText('Directory')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('/absolute/path/on/the/server')).toBeInTheDocument()
  })

  it('disables Start session until a directory is entered', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Open directory' }))

    expect(screen.getByRole('button', { name: /Start session/ })).toBeDisabled()

    await user.type(screen.getByLabelText('Directory'), '   ')
    expect(screen.getByRole('button', { name: /Start session/ })).toBeDisabled()

    await user.type(screen.getByLabelText('Directory'), '/srv/other')
    expect(screen.getByRole('button', { name: /Start session/ })).toBeEnabled()
  })

  it('clears the directory when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Open directory' }))
    await user.type(screen.getByLabelText('Directory'), '/srv/other')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByLabelText('Directory')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Open directory' }))
    expect(await screen.findByLabelText('Directory')).toHaveValue('')
  })

  it('filters projects by name and path', async () => {
    const user = userEvent.setup()
    mocks.listProjects.mockResolvedValue([project, otherProject])
    renderProjectList()

    await screen.findByText('App')
    const search = screen.getByPlaceholderText('Search projects...')

    await user.type(search, '/srv/other')
    expect(screen.queryByText('App')).not.toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'app')
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
  })

  it('shows an empty search result state', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await screen.findByText('App')
    await user.type(screen.getByPlaceholderText('Search projects...'), 'missing')

    expect(screen.getByText('No projects found matching "missing"')).toBeInTheDocument()
  })

  it('shows the disabled state without loading projects', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...server, enabled: false }],
      isLoading: false,
      showsInitialLoading: false,
    })

    renderProjectList()

    expect(screen.getByText('This server is disabled')).toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('shows a missing server state when the server is no longer configured', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      isLoading: false,
      showsInitialLoading: false,
    })

    renderProjectList('srv_gone')

    expect(screen.getByText('Server not found')).toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('loads instead of reporting a missing server while the server list is restoring', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      isLoading: false,
      showsInitialLoading: true,
    })

    const { container } = renderProjectList('srv_gone')

    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows an empty state when the server has no projects', async () => {
    mocks.listProjects.mockResolvedValue([])

    renderProjectList()

    await waitFor(() => {
      expect(screen.getByText('No projects on this server yet')).toBeInTheDocument()
    })
  })

  it('shows the load error when no project data is cached', async () => {
    mocks.listProjects.mockRejectedValue(new Error('offline'))

    renderProjectList()

    expect(await screen.findByText('Could not load projects')).toBeInTheDocument()
  })

  it('keeps the cached project list when a refetch fails', async () => {
    const queryClient = createQueryClient()
    mocks.listProjects.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('offline'))

    renderProjectList('srv_kitchen', queryClient)

    await screen.findByText('App')
    await act(async () => {
      await queryClient.refetchQueries()
    })

    await waitFor(() => {
      expect(mocks.listProjects).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.queryByText('Could not load projects')).not.toBeInTheDocument()
  })

  it('scopes the list to the given server rather than the route', async () => {
    renderProjectList('srv_kitchen')

    await waitFor(() => {
      expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
    })
  })
})
