import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { OpenCodeProject } from '@/api/opencode'
import type { Repo } from '@/api/types'
import { makeOpenCodeServer, makeRepo, makeSession } from '@/test/fixtures/api'
import { installMatchMedia } from '@/test/browserFakes'
import { createSessionServer, type SessionServer } from '@/test/fixtures/sessionServer'
import type { FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { SessionPickerSheet } from './SessionPickerSheet'

const repos: Repo[] = [
  makeRepo({ id: 1, name: 'alpha', fullPath: '/w/a', localPath: '/w/a' }),
  makeRepo({ id: 2, name: 'beta', fullPath: '/w/b', localPath: '/w/b' }),
]

function deferred() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function renderSheet(
  server: SessionServer,
  initialEntries: string[] = ['/repos/1?mobileTab=sessions'],
  options: { isOpen?: boolean } = {},
) {
  installMatchMedia(true)
  const onClose = vi.fn()
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const capturedNavigationType = { current: '' }
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <SessionPickerSheet isOpen={options.isOpen ?? true} onClose={onClose} />
      <LocationCatcher
        capturedPathname={capturedPathname}
        capturedSearch={capturedSearch}
        capturedNavigationType={capturedNavigationType}
      />
    </KeyboardShortcutsProvider>,
    { initialEntries, events: true, fetchRoutes: server.routes },
  )
  return {
    ...result,
    onClose,
    location: () => `${capturedPathname.current}${capturedSearch.current} ${capturedNavigationType.current}`,
  }
}

function session(id: string, title: string, directory: string, updated = Date.now()) {
  return makeSession({ id, title, location: { directory }, time: { created: updated, updated } })
}

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })

describe('SessionPickerSheet', () => {
  it('renders the picker in a bottom sheet with Activity, Sessions and Projects tabs', async () => {
    renderSheet(createSessionServer({ repos, remoteServers: [kitchen] }), ['/'])

    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /Switch server, current:/ }),
    ).toBeInTheDocument()
  })

  it('navigates to the chosen session, replacing the sheet history entry', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_one', 'Solo session', '/w/a')],
    })

    const { location } = renderSheet(server)

    fireEvent.click(await screen.findByRole('option', { name: /Solo session/ }))

    await waitFor(() => expect(location()).toBe('/repos/1/sessions/ses_one REPLACE'))
  })

  it('closes instead of navigating when the chosen session is already open', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_one', 'Solo session', '/w/a')],
    })

    const { onClose, location } = renderSheet(server, ['/repos/1/sessions/ses_one?mobileTab=sessions'])

    fireEvent.click(await screen.findByRole('option', { name: /Solo session/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(location()).toBe('/repos/1/sessions/ses_one?mobileTab=sessions POP')
  })

  it('creates a session in the current repo from the header action and opens it', async () => {
    const server = createSessionServer({ repos })
    const { location } = renderSheet(server)

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    await waitFor(() => expect(server.createdDirectories()).toEqual(['/w/a']))
    await waitFor(() => expect(location()).toBe('/repos/1/sessions/ses_new REPLACE'))
  })

  it('opens the add repository dialog from the projects tab header action', async () => {
    const { onClose } = renderSheet(createSessionServer({ repos }))

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(await screen.findByRole('dialog', { name: 'Add Repository' })).toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('lists and opens the linked server sessions when a linked server is selected', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      remoteSessions: [session('ses_remote', 'Remote session', '/home/me/app')],
    })

    const { location } = renderSheet(server)

    const row = await screen.findByRole('option', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(screen.queryByRole('tab', { name: 'This project' })).not.toBeInTheDocument()

    fireEvent.click(row)

    expect(location()).toBe('/servers/srv_kitchen/sessions/ses_remote REPLACE')
  })

  it('lists the linked server projects on the projects tab and opens one', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const project: OpenCodeProject = {
      id: 'p1',
      name: 'Alpha',
      canonical: '/projects/alpha',
      time: { created: 1, updated: 2 },
      sandboxes: [],
    }
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      projects: [project],
    })

    const { location } = renderSheet(server)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByText('Alpha'))

    expect(location()).toBe('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha REPLACE')
  })

  it('follows the sidebar server selection to list that server', async () => {
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      remoteSessions: [session('ses_remote', 'Remote session', '/home/me/app')],
    })

    renderSheet(server)

    act(() => {
      useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    })

    const row = await screen.findByRole('option', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(screen.queryByRole('tab', { name: 'This project' })).not.toBeInTheDocument()
  })

  it('lists activity sessions and opens one', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_active', 'Active ses_active', '/w/a')],
    })

    const { location } = renderSheet(server)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_active/ }))

    expect(location()).toBe('/repos/1/sessions/ses_active REPLACE')
  })

  it('opens a remote activity row on its own server while the local server is selected', async () => {
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      remoteSessions: [session('ses_kitchen', 'Active ses_kitchen', '/home/me/app')],
    })

    const { location } = renderSheet(server)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_kitchen/ }))

    expect(location()).toBe('/servers/srv_kitchen/sessions/ses_kitchen REPLACE')
  })

  it('opens a remote activity row of the same session id that is open on another server', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const hall = makeOpenCodeServer({ id: 'srv_hall', name: 'Hall' })
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen, hall],
      remoteSessions: [session('ses_shared', 'Active ses_shared', '/home/me/hall')],
    })

    const { onClose, location } = renderSheet(server, [
      '/servers/srv_kitchen/sessions/ses_shared?mobileTab=sessions',
    ])

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_shared/ }))

    expect(onClose).not.toHaveBeenCalled()
    expect(location()).toBe('/servers/srv_hall/sessions/ses_shared REPLACE')
  })

  it('opens a local session row that shares the id of the open remote session', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_shared', 'Shared session', '/w/a')],
      remoteServers: [kitchen],
    })

    const { onClose, location } = renderSheet(server, [
      '/servers/srv_kitchen/sessions/ses_shared?mobileTab=sessions',
    ])

    fireEvent.click(await screen.findByRole('option', { name: /Shared session/ }))

    expect(onClose).not.toHaveBeenCalled()
    expect(location()).toBe('/repos/1/sessions/ses_shared REPLACE')
  })

  it('opens a session row of another linked server than the selected one', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const hall = makeOpenCodeServer({ id: 'srv_hall', name: 'Hall' })
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen, hall],
      remoteSessions: [session('ses_hall', 'Active ses_hall', '/home/me/hall')],
    })

    const { location } = renderSheet(server)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_hall/ }))

    expect(location()).toBe('/servers/srv_hall/sessions/ses_hall REPLACE')
  })

  it('keeps the assistant session flag when choosing another session of the same repo', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_b', 'Second assistant session', '/w/a')],
    })

    const { location } = renderSheet(server, ['/repos/1/sessions/ses_a?assistant=1&mobileTab=sessions'])

    fireEvent.click(await screen.findByRole('option', { name: /Second assistant session/ }))

    expect(location()).toBe('/repos/1/sessions/ses_b?assistant=1 REPLACE')
  })

  it('drops the assistant session flag when choosing a session of another repo', async () => {
    localStorage.setItem('oc:session-picker:all-projects', 'true')
    const server = createSessionServer({
      repos,
      sessions: [
        session('ses_a', 'Assistant session', '/w/a'),
        session('ses_b', 'Beta session', '/w/b'),
      ],
    })

    const { location } = renderSheet(server, ['/repos/1/sessions/ses_a?assistant=1&mobileTab=sessions'])

    fireEvent.click(await screen.findByRole('option', { name: /Beta session/ }))

    expect(location()).toBe('/repos/2/sessions/ses_b REPLACE')
  })

  it('scopes the sheet to the open remote session directory on a linked server session route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      remoteSessions: [session('ses_remote', 'Remote session', '/home/me/app')],
    })

    renderSheet(server, ['/servers/srv_kitchen/sessions/ses_remote?mobileTab=sessions'])

    await waitFor(() => {
      const remoteList = server.sessionRequests().filter((request) =>
        request.path.startsWith('/api/opencode/servers/srv_kitchen/api/session'),
      )
      expect(
        remoteList.some((request) => request.searchParams.get('directory') === '/home/me/app'),
      ).toBe(true)
    })
  })

  it('scopes the sheet to the canonical project directory of a remote session subdirectory', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      remoteSessions: [session('ses_remote', 'Remote session', '/home/me/app/packages/web')],
      projects: [
        {
          id: 'p1',
          name: 'App',
          canonical: '/home/me/app',
          time: { created: 1, updated: 2 },
          sandboxes: [],
        },
      ],
      sessionRespond: (_request, params) => {
        const found = [session('ses_remote', 'Remote session', '/home/me/app/packages/web')].find(
          (candidate) => candidate.id === params.sessionID,
        )
        return found ? { json: { data: found } } : { status: 404, json: { error: 'missing' } }
      },
    })

    renderSheet(server, ['/servers/srv_kitchen/sessions/ses_remote?mobileTab=sessions'])

    await waitFor(() => {
      const remoteList = server.sessionRequests().filter((request) =>
        request.path.startsWith('/api/opencode/servers/srv_kitchen/api/session'),
      )
      expect(remoteList.some((request) => request.searchParams.get('directory') === '/home/me/app')).toBe(
        true,
      )
    })
  })

  it('holds the all-directories search while the remote session directory resolves', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const sessionDetail = deferred()
    const server = createSessionServer({
      repos,
      remoteServers: [kitchen],
      sessionRespond: () => sessionDetail.promise,
    })

    const { fetchFake } = renderSheet(server, ['/servers/srv_kitchen/sessions/ses_remote?mobileTab=sessions'])

    await waitFor(() =>
      expect(
        fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/session/ses_remote'),
      ).toHaveLength(1),
    )
    expect(
      fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/session'),
    ).toHaveLength(0)
  })

  it('returns to the repo session list keeping its tab when the open session is deleted', async () => {
    const server = createSessionServer({
      repos,
      sessions: [session('ses_active', 'Active session', '/w/a')],
    })

    const { location } = renderSheet(server, [
      '/repos/1/sessions/ses_active?mobileTab=sessions&repoTab=changes',
    ])

    const combobox = await screen.findByRole('combobox')
    await screen.findByRole('option', { name: /Active session/ })
    fireEvent.keyDown(combobox, { key: 'd', ctrlKey: true })
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Press Ctrl\+D again to confirm/ })).toBeInTheDocument(),
    )
    fireEvent.keyDown(combobox, { key: 'd', ctrlKey: true })

    await waitFor(() => expect(server.deletedSessionIDs()).toEqual(['ses_active']))
    expect(location()).toBe('/repos/1?repoTab=changes REPLACE')
  })

  it('does not resolve the remote session directory while the sheet is closed', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const server = createSessionServer({ repos, remoteServers: [kitchen] })

    renderSheet(server, ['/servers/srv_kitchen/sessions/ses_remote'], { isOpen: false })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      server
        .sessionRequests()
        .some((request) => request.path === '/api/opencode/servers/srv_kitchen/api/session/ses_remote'),
    ).toBe(false)
  })

  it('prefetches the project location on a repo route while the sheet is closed', async () => {
    const server = createSessionServer({ repos })

    const { fetchFake } = renderSheet(server, ['/repos/1'], { isOpen: false })

    await waitFor(() =>
      expect(fetchFake.findRequests('GET', '/api/opencode/api/location')).toHaveLength(1),
    )
  })

  it('does not prefetch the project location outside a repo route', async () => {
    const server = createSessionServer({ repos })

    const { fetchFake } = renderSheet(server, ['/'], { isOpen: false })

    await waitFor(() => expect(fetchFake.lastRequest('GET', '/api/repos')).toBeDefined())
    expect(fetchFake.findRequests('GET', '/api/opencode/api/location')).toHaveLength(0)
  })
})
