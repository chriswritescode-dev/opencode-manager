import { describe, it, expect, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, type QueryClient } from '@tanstack/react-query'
import type { OpenCodeProject } from '@/api/opencode'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { RemoteProjectList } from '../RemoteProjectList'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeOpenCodeServer, makeSession } from '@/test/fixtures/api'
import { installWindowSize } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const SERVER_ID = 'srv_kitchen'
const SERVER_BASE = `/api/opencode/servers/${SERVER_ID}/api`

const server = makeOpenCodeServer({ id: SERVER_ID, name: 'Kitchen', enabled: true })

function makeProject(overrides: Partial<OpenCodeProject> = {}): OpenCodeProject {
  return {
    id: 'prj_1',
    canonical: '/home/me/app',
    name: 'App',
    vcs: 'git',
    time: { created: Date.now() - 120_000, updated: Date.now() - 60_000, active: 2 },
    sandboxes: [],
    ...overrides,
  }
}

const project = makeProject()
const otherProject = makeProject({
  id: 'prj_2',
  canonical: '/srv/other',
  name: 'Other',
  time: { created: Date.now() - 120_000, updated: Date.now() - 60_000, active: 2 },
})

interface RemoteListFixture {
  servers?: OpenCodeServer[]
  serverLoader?: () => FetchRouteResult | Promise<FetchRouteResult>
  projects?: OpenCodeProject[]
  projectLoader?: () => FetchRouteResult | Promise<FetchRouteResult>
  sessions?: ReturnType<typeof makeSession>[]
  createSession?: () => FetchRouteResult | Promise<FetchRouteResult>
}

function serverLoader(fixture: RemoteListFixture): () => FetchRouteResult | Promise<FetchRouteResult> {
  return fixture.serverLoader ?? (() => ({ json: { servers: fixture.servers ?? [server] } }))
}

function projectLoader(fixture: RemoteListFixture): () => FetchRouteResult | Promise<FetchRouteResult> {
  return fixture.projectLoader ?? (() => ({ json: fixture.projects ?? [project] }))
}

function buildRoutes(fixture: RemoteListFixture): FetchRoute[] {
  const sessions = (fixture.sessions ?? []).map((session) => session)
  return [
    { method: 'GET', path: '/api/opencode-servers', respond: () => serverLoader(fixture)() },
    { method: 'GET', path: `${SERVER_BASE}/project`, respond: () => projectLoader(fixture)() },
    {
      method: 'GET',
      path: `${SERVER_BASE}/session`,
      respond: () => ({ json: { data: sessions, cursor: { next: null } } }),
    },
    {
      method: 'POST',
      path: `${SERVER_BASE}/session`,
      respond: () => fixture.createSession?.() ?? { json: { data: makeSession({ id: 'ses_new' }) } },
    },
    { method: 'GET', path: `${SERVER_BASE}/provider`, respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: `${SERVER_BASE}/model`, respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: `${SERVER_BASE}/config`, respond: () => ({ json: {} }) },
    { method: 'GET', path: `${SERVER_BASE}/model/default`, respond: () => ({ json: { data: null } }) },
    { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: {} }) },
    { method: 'GET', path: '/api/schedules/all', respond: () => ({ json: { jobs: [] } }) },
    { method: 'GET', path: '/api/multi-runs', respond: () => ({ json: { runs: [] } }) },
  ]
}

function renderProjectList(
  fixture: RemoteListFixture = {},
  options: { serverId?: string; queryClient?: QueryClient; mobile?: boolean } = {},
) {
  installWindowSize(options.mobile === false ? 1024 : 500)
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <RemoteProjectList serverId={options.serverId ?? SERVER_ID} />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      theme: false,
      toaster: false,
      events: true,
      queryClient: options.queryClient,
      fetchRoutes: buildRoutes(fixture),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('RemoteProjectList', () => {
  it('lists projects from the remote server', async () => {
    const result = renderProjectList()

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.getByText('/home/me/app')).toBeInTheDocument()
    expect(result.fetchFake.lastRequest('GET', `${SERVER_BASE}/project`)).toBeDefined()
  })

  it('labels a row with its newest session time instead of the project activity time', async () => {
    const now = Date.now()
    renderProjectList({
      projects: [makeProject({ time: { created: now - 10_800_000, updated: now - 10_800_000, active: now } })],
      sessions: [makeSession({ id: 'ses_1', location: { directory: '/home/me/app' }, time: { created: now - 300_000, updated: now - 300_000 } })],
    })

    await screen.findByText('App')
    expect(await screen.findByText('5m ago')).toBeInTheDocument()
  })

  it('labels a row with the update time when the project has no session in the fetched page', async () => {
    const now = Date.now()
    renderProjectList({
      projects: [makeProject({ time: { created: now - 10_800_000, updated: now - 300_000, active: now } })],
    })

    await screen.findByText('App')
    expect(await screen.findByText('5m ago')).toBeInTheDocument()
  })

  it('orders projects by their newest session, not by the project activity time', async () => {
    const now = Date.now()
    renderProjectList({
      projects: [
        makeProject({ time: { created: now - 10_800_000, updated: now - 10_800_000, active: now } }),
        { ...otherProject, time: { created: now - 10_800_000, updated: now - 10_800_000, active: now - 3_600_000 } },
      ],
      sessions: [makeSession({ id: 'ses_1', location: { directory: '/srv/other' }, time: { created: now - 120_000, updated: now - 120_000 } })],
    })

    await screen.findByText('App')
    await waitFor(() => expect(screen.getByText('Other')).toBeInTheDocument())
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
    const result = renderProjectList()

    await user.click(await screen.findByText('App'))

    await waitFor(() => expect(result.capturedPathname.current).toBe('/servers/srv_kitchen/projects'))
    expect(result.capturedSearch.current).toBe('?directory=%2Fhome%2Fme%2Fapp')
  })

  it('creates a session in a project directory from the actions menu and navigates to it', async () => {
    const user = userEvent.setup()
    const result = renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /New session/ }))

    await waitFor(() => expect(result.fetchFake.lastRequest('POST', `${SERVER_BASE}/session`)).toBeDefined())
    expect(result.fetchFake.lastRequest('POST', `${SERVER_BASE}/session`)?.body).toMatchObject({
      location: { directory: '/home/me/app' },
    })
    await waitFor(() => expect(result.capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_new'))
  })

  it('opens the project schedules from the actions menu', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Schedules/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Schedules' })
    expect(within(dialog).getByText('/home/me/app')).toBeInTheDocument()
  })

  it('opens multi-run for the project from the actions menu', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Multi-run/ }))

    expect(await screen.findByRole('dialog', { name: 'Multi-run' })).toBeInTheDocument()
  })

  it('shows inline project actions on desktop without opening the project', async () => {
    const user = userEvent.setup()
    renderProjectList({}, { mobile: false })

    await screen.findByText('App')
    expect(screen.queryByRole('button', { name: 'Project actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Multi-run' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Schedules' }))

    const dialog = await screen.findByRole('dialog', { name: 'Schedules' })
    expect(within(dialog).getByText('/home/me/app')).toBeInTheDocument()
  })

  it('opens a session in an arbitrary directory from the dialog', async () => {
    const user = userEvent.setup()
    const result = renderProjectList()

    await user.click(await screen.findByRole('button', { name: 'Open directory' }))
    await user.type(screen.getByLabelText('Directory'), '/srv/other')
    await user.click(screen.getByRole('button', { name: /Start session/ }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', `${SERVER_BASE}/session`)?.body).toMatchObject({
        location: { directory: '/srv/other' },
      }),
    )
  })

  it('does not render the open-directory form in the list until the dialog opens', async () => {
    const user = userEvent.setup()
    renderProjectList()

    await screen.findByText('App')
    expect(screen.queryByLabelText('Directory')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('/absolute/path/on/the/server')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open directory' }))

    expect(await screen.findByLabelText('Directory')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('/absolute/path/on/the/server')).toBeInTheDocument()
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

    await waitFor(() => expect(screen.queryByLabelText('Directory')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Open directory' }))
    expect(await screen.findByLabelText('Directory')).toHaveValue('')
  })

  it('filters projects by name and path', async () => {
    const user = userEvent.setup()
    renderProjectList({ projects: [project, otherProject] })

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
    const result = renderProjectList({ servers: [{ ...server, enabled: false }] })

    expect(await screen.findByText('This server is disabled')).toBeInTheDocument()
    expect(result.fetchFake.findRequests('GET', `${SERVER_BASE}/project`)).toHaveLength(0)
  })

  it('shows a missing server state when the server is no longer configured', async () => {
    const result = renderProjectList({ servers: [] }, { serverId: 'srv_gone' })

    expect(await screen.findByText('Server not found')).toBeInTheDocument()
    expect(result.fetchFake.findRequests('GET', `/api/opencode/servers/srv_gone/api/project`)).toHaveLength(0)
  })

  it('loads instead of reporting a missing server while the server list is restoring', async () => {
    const { container } = renderProjectList(
      { serverLoader: () => new Promise<FetchRouteResult>(() => {}) },
      { serverId: 'srv_gone' },
    )

    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows an unavailable state instead of a missing server while the server list is paused offline', async () => {
    const queryClient = createTestQueryClient()
    onlineManager.setOnline(false)
    const result = renderProjectList({ servers: [] }, { queryClient })

    expect(await screen.findByText('Servers unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(result.container.querySelectorAll('.animate-pulse')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(result.fetchFake.findRequests('GET', `${SERVER_BASE}/project`)).toHaveLength(0)
  })

  it('keeps the cached project list while a server list refetch is paused offline', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode-servers'], [server])
    queryClient.setQueryData(['opencode', 'projects', SERVER_ID], [project])
    onlineManager.setOnline(false)

    renderProjectList({}, { queryClient })

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.queryByText('Servers unavailable')).not.toBeInTheDocument()
  })

  it('shows an empty state when the server has no projects', async () => {
    renderProjectList({ projects: [] })

    expect(await screen.findByText('No projects on this server yet')).toBeInTheDocument()
  })

  it('shows the load error when no project data is cached', async () => {
    renderProjectList({
      projectLoader: () => {
        throw new Error('offline')
      },
    })

    expect(await screen.findByText('Could not load projects')).toBeInTheDocument()
  })

  it('keeps the cached project list when a refetch fails', async () => {
    const queryClient = createTestQueryClient()
    let calls = 0
    renderProjectList({
      projectLoader: () => {
        calls += 1
        if (calls > 1) throw new Error('offline')
        return { json: [project] }
      },
    }, { queryClient })

    await screen.findByText('App')
    await act(async () => {
      await queryClient.refetchQueries()
    })

    await waitFor(() => expect(calls).toBeGreaterThan(1))
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.queryByText('Could not load projects')).not.toBeInTheDocument()
  })

  it('scopes the list to the given server rather than the route', async () => {
    const result = renderProjectList()

    await waitFor(() => expect(result.fetchFake.findRequests('GET', `${SERVER_BASE}/project`).length).toBeGreaterThan(0))
  })
})
