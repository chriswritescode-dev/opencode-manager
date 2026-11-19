import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeOpenCodeServer, makeSession } from '@/test/fixtures/api'
import { installMatchMedia, installWindowSize } from '@/test/browserFakes'
import { connectTestEventStream } from '@/test/render'
import { renderRemoteSessionPage } from '@/test/sessionPage'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { getServerProjectPath } from '@/lib/navigation'
import type { FetchRouteResult } from '@/test/fetchFake'
import type { OpenCodeProject } from '@/api/opencode'
import type { SessionPageOptions } from '@/test/sessionPage'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { SwipeNavigationValue } from '@/contexts/swipe-navigation-context'

const SERVER_ID = 'srv_kitchen'
const SESSION_ID = 'ses_remote'
const REMOTE_DIRECTORY = '/home/me/app'

const server = makeOpenCodeServer({
  id: SERVER_ID,
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
})

const project: OpenCodeProject = {
  id: 'prj_1',
  canonical: REMOTE_DIRECTORY,
  name: 'App',
  time: { created: 1, updated: 2, active: 2 },
  sandboxes: [],
}

const remoteSession = makeSession({
  id: SESSION_ID,
  title: 'Remote chat',
  location: { directory: REMOTE_DIRECTORY },
})

const otherSession = makeSession({
  id: 'ses_other',
  title: 'Other chat',
  location: { directory: REMOTE_DIRECTORY },
})

const sessionPath = `/servers/${SERVER_ID}/sessions/${SESSION_ID}`
const remoteApi = `/api/opencode/servers/${SERVER_ID}/api`

interface SwipeNavigationCapture {
  current: SwipeNavigationValue | null
}

function connectedStatus(): FetchRouteResult {
  return { json: { statuses: [{ serverId: SERVER_ID, connected: true, version: null, error: null }] } }
}

function disconnectedStatus(): FetchRouteResult {
  return { json: { statuses: [{ serverId: SERVER_ID, connected: false, version: null, error: null }] } }
}

function renderRemoteSession(options: SessionPageOptions = {}) {
  return renderRemoteSessionPage(SERVER_ID, {
    route: sessionPath,
    session: remoteSession,
    projects: [project],
    ...options,
    servers: options.servers ?? (() => ({ json: { servers: [server] } })),
    serverStatuses: options.serverStatuses ?? connectedStatus,
  })
}

function childSessionMessage(): SessionMessageInfo {
  return {
    id: 'msg_child',
    type: 'synthetic',
    text: '<subagent sessionID="ses_child" state="completed" description="Explore">\ndone\n</subagent>',
    description: 'Explore',
    metadata: { source: 'subagent', state: 'completed', childID: 'ses_child', agent: 'explore' },
    time: { created: 1 },
  }
}

async function clickSessionShortcut() {
  fireEvent.keyDown(document.body, { key: 'x', ctrlKey: true })
  fireEvent.keyDown(document.body, { key: 'l' })
}

beforeEach(() => {
  installMatchMedia(false)
  installWindowSize(900)
})

describe('SessionDetail remote server mode', () => {
  it('leaves the Manager repo out of a remote session', async () => {
    const { fetchFake } = renderRemoteSession()

    expect(await screen.findByText('Remote chat')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
    expect(fetchFake.findRequests('GET', `${remoteApi}/session/${SESSION_ID}/message`)).toHaveLength(1)
  })

  it('shows the remote project in the header without the server name', async () => {
    renderRemoteSession()

    expect(await screen.findByLabelText('Remote server')).toBeInTheDocument()
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument()
  })

  it('returns to the remote project page from the header back button', async () => {
    const user = userEvent.setup()
    const { capturedPathname, capturedSearch } = renderRemoteSession()

    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(capturedPathname.current).toBe(`/servers/${SERVER_ID}/projects`))
    expect(capturedSearch.current).toBe('?directory=%2Fhome%2Fme%2Fapp')
  })

  it('registers the remote project page as the swipe-back target once the directory resolves', async () => {
    const swipeNavigation: SwipeNavigationCapture = { current: null }
    const { unmount } = renderRemoteSession({ swipeNavigation })

    await waitFor(() => {
      expect(swipeNavigation.current?.backTarget()).toBe(getServerProjectPath(SERVER_ID, REMOTE_DIRECTORY))
    })

    unmount()

    expect(swipeNavigation.current?.backTarget()).toBeNull()
  })

  it('falls back to the projects list when the session is not found', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderRemoteSession({
      sessionRespond: () => ({ status: 404, json: { name: 'SessionNotFoundError', message: 'Session not found' } }),
    })

    await user.click(await screen.findByRole('button', { name: 'Back to projects' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/'))
  })

  it('syncs pending actions for the session directory on the linked server', async () => {
    const { fetchFake } = renderRemoteSession()

    await waitFor(() => {
      expect(
        fetchFake.lastRequest('GET', `${remoteApi}/permission/request`)?.searchParams.get('location[directory]'),
      ).toBe(REMOTE_DIRECTORY)
    })
    expect(fetchFake.lastRequest('GET', `${remoteApi}/form`)?.searchParams.get('location[directory]')).toBe(
      REMOTE_DIRECTORY,
    )
  })

  it('keeps only the remote-capable tools and the More button', async () => {
    renderRemoteSession()
    await screen.findByText('Remote chat')

    for (const label of ['Sessions', 'MCP', 'Skills', 'Source Control', 'Terminal']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const label of ['Files', 'Preview', 'Actions', 'Schedules', 'Secrets']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('shows the session goal bar for a remote session', async () => {
    const { fetchFake } = renderRemoteSession({
      extraRoutes: [
        {
          method: 'POST',
          path: `${remoteApi}/rpc/opencode.goal/get`,
          respond: () => ({
            json: {
              output: {
                id: 'goal_1',
                objective: 'Ship the release',
                status: 'active',
                rounds: 1,
                maxRounds: 5,
                boot: 'boot',
                updatedAt: 1,
              },
            },
          }),
        },
      ],
    })

    expect(await screen.findByText('Ship the release')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', `${remoteApi}/rpc/opencode.goal/get`).length).toBeGreaterThan(0)
  })

  it('opens terminals for the linked server', async () => {
    const { fetchFake } = renderRemoteSession({
      route: `${sessionPath}?panel=terminal`,
      extraRoutes: [
        { method: 'GET', path: `/api/opencode-servers/${SERVER_ID}/terminals`, respond: () => ({ json: { terminals: [] } }) },
        { method: 'POST', path: `/api/opencode-servers/${SERVER_ID}/terminals`, respond: () => ({ json: { id: 'term_1', kind: 'shell', status: 'running', title: 'Terminal 1' } }) },
      ],
    })

    expect(await screen.findByRole('complementary', { name: 'Terminal' })).toBeInTheDocument()
    await waitFor(() => {
      expect(
        fetchFake.lastRequest('GET', `/api/opencode-servers/${SERVER_ID}/terminals`)?.searchParams.get('directory'),
      ).toBe(REMOTE_DIRECTORY)
    })
  })

  it('opens MCP scoped to the remote session directory', async () => {
    const { fetchFake } = renderRemoteSession({ route: `${sessionPath}?panel=mcp` })

    expect(await screen.findByRole('complementary', { name: 'MCP' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchFake.lastRequest('GET', `${remoteApi}/mcp`)?.searchParams.get('location[directory]')).toBe(
        REMOTE_DIRECTORY,
      )
    })
  })

  it('opens the remote source control panel instead of the Manager one', async () => {
    const { fetchFake } = renderRemoteSession({
      route: `${sessionPath}?panel=sourceControl`,
      extraRoutes: [
        { method: 'GET', path: `${remoteApi}/vcs/status`, respond: () => ({ json: { data: [] } }) },
        { method: 'GET', path: `${remoteApi}/vcs/diff`, respond: () => ({ json: { data: [] } }) },
      ],
    })

    expect(await screen.findByRole('complementary', { name: 'Source Control' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchFake.findRequests('GET', `${remoteApi}/vcs/status`).length).toBeGreaterThan(0)
    })
    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
  })

  it.each([
    { name: 'treats the remote server as disconnected when its status is down', statuses: disconnectedStatus, connects: true, banner: false },
    { name: 'keeps the send error visible while both streams are connected', statuses: connectedStatus, connects: true, banner: true },
    { name: 'hides the send error while the Manager stream is down', statuses: connectedStatus, connects: false, banner: false },
  ])('$name', async ({ statuses, connects, banner }) => {
    useSendErrorStore.setState({
      errors: {
        [SESSION_ID]: { sessionID: SESSION_ID, kind: 'network', title: 'Send failed', message: 'Network error' },
      },
    })
    const { eventStream } = renderRemoteSession({ serverStatuses: statuses })
    await screen.findByText('Remote chat')
    if (connects) await connectTestEventStream(eventStream)

    await waitFor(() => {
      expect(screen.queryByText('Send failed') !== null).toBe(banner)
    })
  })

  it('navigates to the parent session from the header pill', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderRemoteSession({
      session: { ...remoteSession, parentID: 'ses_parent' },
    })

    await user.click(await screen.findByRole('button', { name: 'Parent session' }))

    await waitFor(() => expect(capturedPathname.current).toBe(`/servers/${SERVER_ID}/sessions/ses_parent`))
  })

  it('opens the session details sheet from the header title', async () => {
    const user = userEvent.setup()
    renderRemoteSession()

    await user.click(await screen.findByRole('button', { name: 'Session details: Remote chat' }))

    const sheet = await screen.findByRole('dialog', { name: 'Session details' })
    expect(within(sheet).getByText(REMOTE_DIRECTORY)).toBeInTheDocument()
  })

  it('navigates to a child session from the transcript', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderRemoteSession({ messages: [childSessionMessage()] })

    await user.click(await screen.findByText('↳ Explore finished'))

    await waitFor(() => expect(capturedPathname.current).toBe(`/servers/${SERVER_ID}/sessions/ses_child`))
  })

  it('opens the sessions panel from the sessions shortcut', async () => {
    const { capturedSearch } = renderRemoteSession()
    await screen.findByText('Remote chat')

    clickSessionShortcut()

    await waitFor(() => expect(capturedSearch.current).toContain('panel=sessions'))
  })

  it('lists the remote project sessions in the tool panel and opens one on the remote route', async () => {
    useSidebarServerStore.setState({ serverId: SERVER_ID })
    const user = userEvent.setup()
    const { capturedPathname, capturedSearch } = renderRemoteSession({
      route: `${sessionPath}?panel=sessions`,
      extraRoutes: [
        {
          method: 'GET',
          path: `${remoteApi}/session`,
          respond: () => ({ json: { data: [remoteSession, otherSession], cursor: {} } }),
        },
      ],
    })

    await screen.findByText('Remote chat')
    await user.click(await screen.findByRole('option', { name: /Other chat/ }))

    await waitFor(() => expect(capturedPathname.current).toBe(`/servers/${SERVER_ID}/sessions/ses_other`))
    expect(capturedSearch.current).toContain('panel=sessions')
  })

  it('shows a loader until the session directory is available', async () => {
    const { fetchFake } = renderRemoteSession({ sessionRespond: () => new Promise<FetchRouteResult>(() => undefined) })

    expect(screen.getByText('Loading session...')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
  })
})
