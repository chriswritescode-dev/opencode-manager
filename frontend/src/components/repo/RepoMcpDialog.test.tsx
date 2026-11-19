import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoMcpContent } from './RepoMcpDialog'
import { renderWithProviders } from '@/test/render'
import type { JsonObject } from '@opencode-manager/shared/utils'
import type { FetchRoute } from '@/test/fetchFake'

const directory = '/home/me/app'

function mcpStatusRoute(path: string, servers: Array<{ name: string; status: string; integrationID?: string }>): FetchRoute {
  return {
    method: 'GET',
    path,
    respond: () => ({
      json: {
        location: { directory },
        data: servers.map((server) => {
          const info: JsonObject = { name: server.name, status: { status: server.status } }
          if (server.integrationID) info.integrationID = server.integrationID
          return info
        }),
      },
    }),
  }
}

function renderContent(serverId: string, routes: FetchRoute[]) {
  return renderWithProviders(<RepoMcpContent open directory={directory} />, {
    auth: false,
    theme: false,
    serverId,
    fetchRoutes: routes,
  })
}

describe('RepoMcpContent', () => {
  it('reads MCP status from the linked server for the session directory', async () => {
    const { fetchFake } = renderContent('srv_kitchen', [
      mcpStatusRoute('/api/opencode/servers/srv_kitchen/api/mcp', [
        { name: 'server', status: 'connected', integrationID: 'int_1' },
      ]),
    ])

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(
      fetchFake.lastRequest('GET', '/api/opencode/servers/srv_kitchen/api/mcp')?.searchParams.get('location[directory]'),
    ).toBe(directory)
  })

  it('disconnects MCP servers against the linked server', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderContent('srv_kitchen', [
      mcpStatusRoute('/api/opencode/servers/srv_kitchen/api/mcp', [{ name: 'server', status: 'connected' }]),
      { method: 'POST', path: '/api/opencode/servers/srv_kitchen/api/experimental/mcp/:server/disconnect', respond: () => ({ status: 204 }) },
    ])

    await user.click(await screen.findByRole('switch'))

    await waitFor(() =>
      expect(
        fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/experimental/mcp/server/disconnect')?.searchParams.get('location[directory]'),
      ).toBe(directory),
    )
    expect(await screen.findByText('MCP server updated for this location')).toBeInTheDocument()
  })

  it('connects MCP servers against the linked server', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderContent('srv_kitchen', [
      mcpStatusRoute('/api/opencode/servers/srv_kitchen/api/mcp', [{ name: 'server', status: 'disabled' }]),
      { method: 'POST', path: '/api/opencode/servers/srv_kitchen/api/experimental/mcp/:server/connect', respond: () => ({ status: 204 }) },
    ])

    await user.click(await screen.findByRole('switch'))

    await waitFor(() =>
      expect(
        fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/experimental/mcp/server/connect')?.searchParams.get('location[directory]'),
      ).toBe(directory),
    )
  })

  it('hides every Manager OAuth action for a linked server', async () => {
    renderContent('srv_kitchen', [
      mcpStatusRoute('/api/opencode/servers/srv_kitchen/api/mcp', [
        { name: 'server', status: 'connected', integrationID: 'int_1' },
        { name: 'authServer', status: 'needs_auth', integrationID: 'int_2' },
      ]),
    ])

    await screen.findByText('Auth Required')

    expect(screen.queryByTitle('Click for options')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auth' })).not.toBeInTheDocument()
    expect(screen.queryByText('Re-authenticate')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove Auth')).not.toBeInTheDocument()
  })

  it('keeps the Manager OAuth actions for the local server', async () => {
    const user = userEvent.setup()
    renderContent('local', [
      mcpStatusRoute('/api/opencode/api/mcp', [{ name: 'server', status: 'connected', integrationID: 'int_1' }]),
    ])

    expect(await screen.findByText('Connected')).toBeInTheDocument()

    await user.click(screen.getByTitle('Click for options'))

    expect(await screen.findByText('Re-authenticate')).toBeInTheDocument()
    expect(screen.getByText('Remove Auth')).toBeInTheDocument()
  })
})
