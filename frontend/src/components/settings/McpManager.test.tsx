import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FetchError } from '@opencode-manager/shared'
import type { McpServerConfig } from '@opencode-manager/shared/opencode'
import { McpManager } from './McpManager'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const mcp = {
  servers: {
    configured: { type: 'local', command: ['npx', 'server'] },
  },
}

const statusRoute: FetchRoute = {
  method: 'GET',
  path: '/api/opencode/api/mcp',
  respond: () => ({
    json: {
      location: { directory: '/workspace/demo' },
      data: [
        { name: 'configured', status: { status: 'connected' } },
        { name: 'legacy-server', status: { status: 'disabled' } },
      ],
    },
  }),
}

const removeRoute: FetchRoute = {
  method: 'DELETE',
  path: '/api/opencode/api/experimental/mcp/:server',
  respond: () => ({ status: 204 }),
}

async function renderManager(
  onSave: (serverId: string, server: McpServerConfig) => Promise<void>,
  onDelete: (serverId: string) => Promise<void>,
) {
  const result = renderWithProviders(<McpManager mcp={mcp} onSave={onSave} onDelete={onDelete} />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: [statusRoute, removeRoute],
  })
  await screen.findByText('Legacy server')
  return result
}

async function deleteServer(user: ReturnType<typeof userEvent.setup>, displayName: string) {
  await user.click(screen.getByLabelText(`Actions for ${displayName}`))
  await user.click(screen.getByText('Delete Server'))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
}

describe('McpManager', () => {
  it('lists servers reported by the running server that are not in mcp.servers', async () => {
    await renderManager(vi.fn(), vi.fn())

    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.getByText('Legacy server')).toBeInTheDocument()
  })

  it('removes only the mcp.servers entry when deleting a configured server', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { fetchFake } = await renderManager(onSave, onDelete)

    await deleteServer(user, 'Configured')

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('configured'))
    expect(fetchFake.findRequests('DELETE', '/api/opencode/api/experimental/mcp/:server')).toHaveLength(0)
  })

  it('skips the config update for a server that is not in mcp.servers', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { fetchFake } = await renderManager(onSave, onDelete)

    await deleteServer(user, 'Legacy server')

    await waitFor(() => expect(fetchFake.findRequests('DELETE', '/api/opencode/api/experimental/mcp/legacy-server')).toHaveLength(1))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('surfaces the config save error when deleting a configured server', async () => {
    const message = 'Cannot remove mcp.servers.configured: defined in opencode.json, not in opencode.jsonc'
    const onDelete = vi.fn().mockRejectedValue(new FetchError(message, 409))
    const user = userEvent.setup()
    await renderManager(vi.fn().mockResolvedValue(undefined), onDelete)

    await deleteServer(user, 'Configured')

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('saves a new server through the config patch callback', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    await renderManager(onSave, vi.fn().mockResolvedValue(undefined))

    await user.click(screen.getByRole('button', { name: /Add Server/i }))
    await user.type(await screen.findByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'filesystem',
        expect.objectContaining({
          type: 'local',
          command: ['npx', 'server-filesystem', '/tmp'],
        }),
      ),
    )
  })
})
