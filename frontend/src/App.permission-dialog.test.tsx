import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import type { PermissionRequest } from '@opencode-manager/shared/opencode'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { PermissionDialogWrapper } from '@/components/session/PermissionDialogWrapper'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { TestEventStreamTransport } from '@/lib/opencode-event-stream'

const repo = makeRepo({ id: 1, name: 'demo', fullPath: '/workspace/demo' })

const remotePermission: PermissionRequest = {
  id: 'permission-remote',
  sessionID: 'ses_remote',
  action: 'bash',
  resources: ['echo hello'],
  metadata: {},
}

const localPermission: PermissionRequest = {
  id: 'permission-local',
  sessionID: 'ses_local',
  action: 'bash',
  resources: ['echo hello'],
  metadata: {},
}

function buildRoutes(options: { repos?: Array<ReturnType<typeof makeRepo>> } = {}): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/repos', respond: () => ({ json: options.repos ?? [repo] }) },
    { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
    { method: 'GET', path: '/api/opencode/api/session/active', respond: () => ({ json: { data: {} } }) },
    { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/form', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/shell', respond: () => ({ json: { data: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/servers/srv_kitchen/api/session/ses_remote',
      respond: () => ({
        json: { data: makeSession({ id: 'ses_remote', title: 'Kitchen deploy', location: { directory: '/srv/app' } }) },
      }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/session/ses_local',
      respond: () => ({
        json: { data: makeSession({ id: 'ses_local', title: 'Local work', location: { directory: '/workspace/demo' } }) },
      }),
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/permission/:permissionId/reply',
      respond: () => ({ status: 204 }),
    },
    {
      method: 'POST',
      path: '/api/opencode/servers/:serverId/api/session/:sessionId/permission/:permissionId/reply',
      respond: () => ({ status: 204 }),
    },
  ]
}

async function pushPermission(
  eventStream: TestEventStreamTransport | undefined,
  permission: PermissionRequest,
  options: { serverId?: string; directory?: string } = {},
) {
  await connectTestEventStream(eventStream)
  const message: JsonObject = {
    id: 'evt_permission',
    created: 1,
    type: 'permission.asked',
    data: {
      id: permission.id,
      sessionID: permission.sessionID,
      action: permission.action,
      resources: permission.resources,
      metadata: {},
    },
  }
  if (options.serverId !== undefined) message.serverId = options.serverId
  if (options.directory !== undefined) message.directory = options.directory
  act(() => eventStream?.message(message))
}

describe('PermissionDialogWrapper', () => {
  it('opens the requested session for a linked-server permission', async () => {
    const capturedPathname = { current: '' }
    const capturedSearch = { current: '' }
    const { eventStream } = renderWithProviders(
      <>
        <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
        <Routes>
          <Route path="/servers/:serverId/sessions/:sessionId" element={<PermissionDialogWrapper />} />
        </Routes>
      </>,
      {
        route: '/servers/srv_kitchen/sessions/ses_viewer',
        events: true,
        fetchRoutes: buildRoutes(),
      },
    )

    await pushPermission(eventStream, remotePermission, { serverId: 'srv_kitchen' })

    expect(await screen.findByText('Permission Request')).toBeInTheDocument()
    expect(await screen.findByText('Allow bash?')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open session' }))

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_remote')
    })
  })

  it('offers the session for a local permission resolved through its Manager repository', async () => {
    const { eventStream, queryClient } = renderWithProviders(
      <Routes>
        <Route path="/repos/:id/sessions/:sessionId" element={<PermissionDialogWrapper />} />
      </Routes>,
      {
        route: '/repos/1/sessions/ses_viewer',
        events: true,
        fetchRoutes: buildRoutes(),
      },
    )

    await waitFor(() => expect(queryClient.getQueryData(['repos'])).toEqual([repo]))
    await pushPermission(eventStream, localPermission, { directory: repo.fullPath })

    expect(await screen.findByRole('button', { name: 'Open session' })).toBeInTheDocument()
  })

  it('hides the session action for a local permission without a Manager repository', async () => {
    const { eventStream } = renderWithProviders(
      <Routes>
        <Route path="/repos/:id/sessions/:sessionId" element={<PermissionDialogWrapper />} />
      </Routes>,
      {
        route: '/repos/1/sessions/ses_viewer',
        events: true,
        fetchRoutes: buildRoutes({ repos: [] }),
      },
    )

    await pushPermission(eventStream, localPermission, { directory: '/other/place' })

    expect(await screen.findByText('Permission Request')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open session' })).not.toBeInTheDocument()
  })

  it('replies with an allow-once decision and dismisses the request', async () => {
    const { eventStream, fetchFake } = renderWithProviders(<PermissionDialogWrapper />, {
      route: '/servers/srv_kitchen/sessions/ses_viewer',
      events: true,
      fetchRoutes: buildRoutes(),
    })

    await pushPermission(eventStream, remotePermission, { serverId: 'srv_kitchen' })

    expect(await screen.findByText('Permission Request')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Allow Once' }))

    await waitFor(() => {
      expect(
        fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/session/ses_remote/permission/permission-remote/reply')?.body,
      ).toEqual({ decision: 'once' })
    })
    await waitFor(() => expect(screen.queryByText('Permission Request')).not.toBeInTheDocument())
  })

  it('sends the denial reason with a reject decision', async () => {
    const { eventStream, fetchFake } = renderWithProviders(<PermissionDialogWrapper />, {
      route: '/servers/srv_kitchen/sessions/ses_viewer',
      events: true,
      fetchRoutes: buildRoutes(),
    })

    await pushPermission(eventStream, remotePermission, { serverId: 'srv_kitchen' })

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Reason (optional)'), 'not allowed')
    await user.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(
        fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/session/ses_remote/permission/permission-remote/reply')?.body,
      ).toEqual({ decision: 'reject', message: 'not allowed' })
    })
  })
})
