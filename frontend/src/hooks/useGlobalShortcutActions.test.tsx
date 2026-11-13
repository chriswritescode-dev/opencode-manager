import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLocation } from 'react-router-dom'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { useGlobalShortcutActions } from './useGlobalShortcutActions'
import { renderWithProviders } from '@/test/render'
import { installWindowSize } from '@/test/browserFakes'
import { makeRepo, makeSession, makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { SessionInfo } from '@opencode-manager/shared/opencode'

const SIDEBAR_STORAGE_KEY = 'oc:sidebar:collapsed'
const LOCAL_SESSION_PATH = '/api/opencode/api/session'
const REMOTE_SESSION_PATH = '/api/opencode/servers/srv_kitchen/api/session'
const REMOTE_SESSION_ID_PATH = '/api/opencode/servers/srv_kitchen/api/session/ses_1'

const leaderKeyRoute: FetchRoute = {
  method: 'GET',
  path: '/api/settings',
  respond: () => ({
    json: makeSettingsResponse({ preferences: makeUserPreferences({ leaderKey: 'Ctrl+O' }) }),
  }),
}

function repoRoute(id: number, fullPath: string): FetchRoute {
  return {
    method: 'GET',
    path: `/api/repos/${id}`,
    respond: () => ({ json: makeRepo({ id, fullPath }) }),
  }
}

const createdSession: SessionInfo = makeSession({ id: 'session-new' })

const createSessionRoute: FetchRoute = {
  method: 'POST',
  path: LOCAL_SESSION_PATH,
  respond: () => ({ json: { data: createdSession } }),
}

const remoteSessionRoute: FetchRoute = {
  method: 'GET',
  path: REMOTE_SESSION_ID_PATH,
  respond: () => ({ json: { data: makeSession({ id: 'ses_1', location: { directory: '/srv/kitchen' } }) } }),
}

const remoteCreateSessionRoute: FetchRoute = {
  method: 'POST',
  path: REMOTE_SESSION_PATH,
  respond: () => ({ json: { data: makeSession({ id: 'session-new' }) } }),
}

function Harness() {
  useGlobalShortcutActions()
  return null
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function pressKey(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    document.body.dispatchEvent(event)
  })
  return event
}

function pressLeaderFollowUp(key: string) {
  pressKey({ key: 'o', ctrlKey: true })
  pressKey({ key })
}

async function renderShortcuts(route: string, routes: FetchRoute[] = []) {
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <Harness />
      <LocationDisplay />
    </KeyboardShortcutsProvider>,
    { route, fetchRoutes: [leaderKeyRoute, ...routes] },
  )
  await waitFor(() => expect(result.queryClient.getQueryState(['settings', 'default'])?.status).toBe('success'))
  return { ...result, location: () => screen.getByTestId('location').textContent }
}

describe('useGlobalShortcutActions', () => {
  it('opens the terminal dialog on the assistant host from the root route', async () => {
    const { location } = await renderShortcuts('/', [repoRoute(0, '/assistant')])

    pressLeaderFollowUp('t')

    await waitFor(() => expect(location()).toBe('/assistant?dialog=terminal'))
  })

  it('navigates to the nearest repo host from a repo sub-route without the tool', async () => {
    const { location } = await renderShortcuts('/repos/5/schedules', [repoRoute(5, '/repo/five')])

    pressLeaderFollowUp('t')

    await waitFor(() => expect(location()).toBe('/repos/5?dialog=terminal'))
  })

  it('toggles the docked panel on and off when the route hosts the tool', async () => {
    const { location } = await renderShortcuts('/repos/5', [repoRoute(5, '/repo/five')])

    pressLeaderFollowUp('t')
    await waitFor(() => expect(location()).toBe('/repos/5?panel=terminal'))

    pressLeaderFollowUp('t')
    await waitFor(() => expect(location()).toBe('/repos/5'))
  })

  it('toggles the dialog instead of the panel on mobile', async () => {
    installWindowSize(375)
    const { location } = await renderShortcuts('/repos/5', [repoRoute(5, '/repo/five')])

    pressLeaderFollowUp('t')

    await waitFor(() => expect(location()).toBe('/repos/5?dialog=terminal'))
  })

  it('creates a session in the repo directory and navigates to it from the leader shortcut', async () => {
    const { location, queryClient, fetchFake } = await renderShortcuts('/repos/5', [
      repoRoute(5, '/repo/five'),
      createSessionRoute,
    ])
    await waitFor(() => expect(queryClient.getQueryState(['repo', 5])?.status).toBe('success'))

    pressKey({ key: 'o', ctrlKey: true })
    pressKey({ key: 'n' })

    await waitFor(() => expect(location()).toBe('/repos/5/sessions/session-new'))
    expect(fetchFake.lastRequest('POST', LOCAL_SESSION_PATH)?.body).toEqual({
      location: { directory: '/repo/five' },
    })
  })

  it('toggles a linked-server route tool without falling back to a Manager host', async () => {
    const { location, fetchFake } = await renderShortcuts('/servers/srv_kitchen/sessions/ses_1', [remoteSessionRoute])

    pressLeaderFollowUp('t')
    await waitFor(() => expect(location()).toBe('/servers/srv_kitchen/sessions/ses_1?panel=terminal'))

    pressLeaderFollowUp('t')
    await waitFor(() => expect(location()).toBe('/servers/srv_kitchen/sessions/ses_1'))
    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
  })

  it('toggles the navigation sidebar instead of the Files panel from the sidebar shortcut', async () => {
    const { location } = await renderShortcuts('/repos/5', [repoRoute(5, '/repo/five')])

    pressLeaderFollowUp('b')

    await waitFor(() => expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true'))
    expect(location()).toBe('/repos/5')

    pressLeaderFollowUp('b')

    await waitFor(() => expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false'))
    expect(location()).toBe('/repos/5')
  })

  it('does not change the persisted sidebar state from the sidebar shortcut on mobile', async () => {
    installWindowSize(375)
    const { location } = await renderShortcuts('/repos/5', [repoRoute(5, '/repo/five')])

    pressLeaderFollowUp('b')

    await act(async () => {
      await Promise.resolve()
    })

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull()
    expect(location()).toBe('/repos/5')
  })

  it('does not fall back to a Manager host for a tool the linked-server route lacks', async () => {
    const { location, fetchFake } = await renderShortcuts('/servers/srv_kitchen/sessions/ses_1', [remoteSessionRoute])

    pressLeaderFollowUp('b')

    await waitFor(() => expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true'))

    expect(location()).toBe('/servers/srv_kitchen/sessions/ses_1')
    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
  })

  it('toggles the terminal dialog on a linked-server route on mobile', async () => {
    installWindowSize(375)
    const { location } = await renderShortcuts('/servers/srv_kitchen/sessions/ses_1', [remoteSessionRoute])

    pressLeaderFollowUp('t')

    await waitFor(() => expect(location()).toBe('/servers/srv_kitchen/sessions/ses_1?dialog=terminal'))
  })

  it('creates a session in the linked server directory and navigates to the server session path', async () => {
    const { location, queryClient, fetchFake } = await renderShortcuts('/servers/srv_kitchen/sessions/ses_1', [
      remoteSessionRoute,
      remoteCreateSessionRoute,
    ])
    await waitFor(() =>
      expect(queryClient.getQueryState(['opencode', 'session', 'ses_1', undefined, 'srv_kitchen'])?.status).toBe(
        'success',
      ),
    )

    pressKey({ key: 'o', ctrlKey: true })
    pressKey({ key: 'n' })

    await waitFor(() => expect(location()).toBe('/servers/srv_kitchen/sessions/session-new'))
    expect(fetchFake.lastRequest('POST', REMOTE_SESSION_PATH)?.body).toEqual({
      location: { directory: '/srv/kitchen' },
    })
  })

  it('does not swallow the follow-up key when the route has no new-session host', async () => {
    const { fetchFake } = await renderShortcuts('/', [repoRoute(0, '/assistant')])

    pressKey({ key: 'o', ctrlKey: true })
    const followUp = pressKey({ key: 'n' })

    expect(followUp.defaultPrevented).toBe(false)
    expect(fetchFake.findRequests('POST', LOCAL_SESSION_PATH)).toHaveLength(0)
  })
})
