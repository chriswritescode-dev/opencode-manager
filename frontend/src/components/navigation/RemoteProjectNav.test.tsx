import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { RemoteProjectNavList } from './RemoteProjectNav'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { makeOpenCodeServer, makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { OpenCodeProject } from '@/api/opencode'
import type { OpenCodeServer, OpenCodeServerStatus } from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })

function createProject(
  id: string,
  name: string | undefined,
  canonical: string,
  time: OpenCodeProject['time'] = { created: 1, updated: 2, active: 0 },
): OpenCodeProject {
  return { id, canonical, name, time, sandboxes: [] }
}

function createSession(id: string, directory: string, updated = Date.now()): SessionInfo {
  return makeSession({ id, title: `Session ${id}`, location: { directory }, time: { created: updated - 10000, updated } })
}

const alpha = createProject('p1', 'Alpha', '/projects/alpha')
const beta = createProject('p2', undefined, '/projects/beta')

function connectedStatus(connected: boolean, error: string | null = null): OpenCodeServerStatus {
  return { serverId: 'srv_kitchen', connected, version: null, error }
}

interface RenderOptions {
  route?: string
  servers?: OpenCodeServer[]
  statuses?: OpenCodeServerStatus[]
  projects?: FetchRoute['respond']
  sessions?: SessionInfo[]
  sessionNextCursor?: string
}

function RemoteListHarness({ serverId }: { serverId: string }) {
  const navigate = useNavigate()
  return (
    <RemoteProjectNavList
      serverId={serverId}
      isVisible
      onOpenProject={navigate}
      onSelectSession={navigate}
    />
  )
}

function renderRemote(options: RenderOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const projectsRoute: FetchRoute = {
    method: 'GET',
    path: '/api/opencode/servers/:serverId/api/project',
    respond: options.projects ?? (() => ({ json: [alpha, beta] })),
  }
  const result = renderWithProviders(
    <>
      <RemoteListHarness serverId="srv_kitchen" />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: options.route ?? '/',
      events: true,
      fetchRoutes: [
        projectsRoute,
        ...appRoutes({
          servers: options.servers ?? [kitchen],
          statuses: options.statuses ?? [connectedStatus(true)],
          projects: [alpha, beta],
          sessions: options.sessions ?? [createSession('a1', '/projects/alpha')],
          sessionNextCursor: options.sessionNextCursor,
        }),
      ],
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

function sessionRequests(fetchFake: ReturnType<typeof renderRemote>['fetchFake']) {
  return fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/session')
}

const toggleFor = (name: string) => screen.getByRole('button', { name: `Show sessions in ${name}` })

describe('RemoteProjectNavList', () => {
  it('renders project names with their directory and activity indicator slot', async () => {
    const { fetchFake } = renderRemote()

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('/projects/alpha')).toBeInTheDocument()
    expect(fetchFake.lastRequest('GET', '/api/opencode/servers/srv_kitchen/api/project')).toBeDefined()
  })

  it('orders projects by their newest session and ignores the project activity time', async () => {
    const { fetchFake } = renderRemote({
      projects: () => ({
        json: [
          createProject('p1', 'Alpha', '/projects/alpha', { created: 1, updated: 900, active: 999 }),
          createProject('p2', 'Beta', '/projects/beta', { created: 1, updated: 100, active: 1 }),
        ],
      }),
      sessions: [createSession('b1', '/projects/beta', 500)],
    })

    await screen.findByText('Beta')
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: /^Show sessions in / })
          .map((button) => button.getAttribute('aria-label')),
      ).toEqual(['Show sessions in Beta', 'Show sessions in Alpha']),
    )

    const activityCalls = sessionRequests(fetchFake).filter(
      (request) => request.searchParams.get('location[directory]') === null,
    )
    expect(activityCalls).toHaveLength(1)
    expect(activityCalls[0].searchParams.get('limit')).toBe('100')
  })

  it('expands the project of the current project route and loads its sessions', async () => {
    const { capturedPathname } = renderRemote({
      route: '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha',
    })

    await waitFor(() => expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'true'))
    expect(await screen.findByRole('button', { name: /Session a1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Session a1/ }))
    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/a1'))
  })

  it('opens a project when its name is clicked', async () => {
    const { capturedPathname, capturedSearch } = renderRemote()

    fireEvent.click(await screen.findByRole('button', { name: /^Alpha/ }))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/projects'))
    expect(capturedSearch.current).toBe('?directory=%2Fprojects%2Falpha')
  })

  it('expands another project and shows its sessions', async () => {
    renderRemote({
      sessions: [createSession('a1', '/projects/alpha'), createSession('b1', '/projects/beta', Date.now() - 1000)],
    })

    await screen.findByText('beta')
    fireEvent.click(toggleFor('beta'))

    expect(await screen.findByRole('button', { name: /Session b1/ })).toBeInTheDocument()
    expect(toggleFor('beta')).toHaveAttribute('aria-expanded', 'true')
  })

  it('creates a session on the selected server and opens it', async () => {
    const { capturedPathname } = renderRemote()

    fireEvent.click(await screen.findByRole('button', { name: 'New session in beta' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/new-session'))
  })

  it('offers All sessions when the project has another page', async () => {
    const { capturedPathname, capturedSearch } = renderRemote({
      route: '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha',
      projects: () => ({ json: [alpha] }),
      sessionNextCursor: 'cursor_2',
    })

    fireEvent.click(await screen.findByText('All sessions'))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/projects'))
    expect(capturedSearch.current).toBe('?directory=%2Fprojects%2Falpha')
  })

  it('shows a disabled state for a disabled server', async () => {
    const { fetchFake } = renderRemote({ servers: [{ ...kitchen, enabled: false }] })

    expect(await screen.findByText('Server is disabled')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/project')).toHaveLength(0)
  })

  it('reports a failed project load', async () => {
    renderRemote({ projects: () => ({ status: 500, json: { error: 'offline' } }) })

    expect(await screen.findByText('Could not load projects')).toBeInTheDocument()
  })

  it('keeps the cached project list when a refetch fails', async () => {
    let attempts = 0
    const { queryClient } = renderRemote({
      projects: () => {
        attempts += 1
        return attempts === 1 ? { json: [alpha, beta] } : { status: 500, json: { error: 'offline' } }
      },
    })

    await screen.findByText('Alpha')
    await act(async () => {
      await queryClient.refetchQueries()
    })

    await waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Could not load projects')).not.toBeInTheDocument()
  })

  it('keeps the project list loading while the cache restore holds the query', async () => {
    renderRemote({
      projects: () => new Promise(() => {}),
    })

    expect(await screen.findByText('Loading projects...')).toBeInTheDocument()
    expect(screen.queryByText('No projects')).not.toBeInTheDocument()
  })

  it('keeps the sidebar loading while the server list is restoring', async () => {
    renderWithProviders(<RemoteListHarness serverId="srv_kitchen" />, {
      events: true,
      fetchRoutes: [
        {
          method: 'GET',
          path: '/api/opencode-servers',
          respond: () => new Promise(() => {}),
        },
      ],
    })

    expect(await screen.findByText('Loading projects...')).toBeInTheDocument()
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
  })

  it('reports an unreachable server list instead of a missing server while paused offline', async () => {
    onlineManager.setOnline(false)
    try {
      renderRemote({ servers: [] })

      expect(await screen.findByText('Servers unavailable')).toBeInTheDocument()
      expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('reports an unreachable server on a failed project load', async () => {
    renderRemote({
      projects: () => ({ status: 500, json: { error: 'offline' } }),
      statuses: [connectedStatus(false, 'boom')],
    })

    expect(await screen.findByText('Server unreachable')).toBeInTheDocument()
  })
})
