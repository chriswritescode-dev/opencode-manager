import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FetchError } from '@opencode-manager/shared'
import type { McpServerConfig } from '@opencode-manager/shared/opencode'
import { McpManager } from './McpManager'

const { mockRemoveServer, mockToastError, mockStatus } = vi.hoisted(() => ({
  mockRemoveServer: vi.fn(),
  mockToastError: vi.fn(),
  mockStatus: {
    configured: { status: 'connected' as const },
    'legacy-server': { status: 'disabled' as const },
  },
}))

vi.mock('@/hooks/useMcpServers', () => ({
  useMcpServers: () => ({
    status: mockStatus,
    isLoading: false,
    refetch: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAuthAsync: vi.fn(),
    isRemovingAuth: false,
  }),
}))

vi.mock('@/api/mcp', () => ({
  mcpApi: { removeServer: mockRemoveServer, startAuth: vi.fn(), getStatus: vi.fn() },
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: mockToastError, info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

const mcp = {
  servers: {
    configured: { type: 'local', command: ['npx', 'server'] },
  },
}

function renderManager(
  onSave: (serverId: string, server: McpServerConfig) => Promise<void>,
  onDelete: (serverId: string) => Promise<void>,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <McpManager mcp={mcp} onSave={onSave} onDelete={onDelete} />
    </QueryClientProvider>,
  )
}

async function deleteServer(user: ReturnType<typeof userEvent.setup>, displayName: string) {
  await user.click(screen.getByLabelText(`Actions for ${displayName}`))
  await user.click(screen.getByText('Delete Server'))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
}

describe('McpManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemoveServer.mockResolvedValue(undefined)
  })

  it('lists servers reported by the running server that are not in mcp.servers', () => {
    renderManager(vi.fn(), vi.fn())

    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.getByText('Legacy server')).toBeInTheDocument()
  })

  it('removes only the mcp.servers entry when deleting a configured server', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderManager(onSave, onDelete)

    await deleteServer(user, 'Configured')

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('configured'))
    expect(mockRemoveServer).not.toHaveBeenCalled()
  })

  it('skips the config update for a server that is not in mcp.servers', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderManager(onSave, onDelete)

    await deleteServer(user, 'Legacy server')

    await waitFor(() => expect(mockRemoveServer).toHaveBeenCalledWith('legacy-server'))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('surfaces the config save error when deleting a configured server', async () => {
    const message = 'Cannot remove mcp.servers.configured: defined in opencode.json, not in opencode.jsonc'
    const onDelete = vi.fn().mockRejectedValue(new FetchError(message, 409))
    const user = userEvent.setup()
    renderManager(vi.fn().mockResolvedValue(undefined), onDelete)

    await deleteServer(user, 'Configured')

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(message))
    expect(mockRemoveServer).not.toHaveBeenCalled()
  })

  it('saves a new server through the config patch callback', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderManager(onSave, vi.fn().mockResolvedValue(undefined))

    await user.click(screen.getByRole('button', { name: /Add Server/i }))
    await user.type(await screen.findByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('filesystem', expect.objectContaining({
      type: 'local',
      command: ['npx', 'server-filesystem', '/tmp'],
    })))
  })
})
