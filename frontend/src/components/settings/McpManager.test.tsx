import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FetchError } from '@opencode-manager/shared'
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
    addServerAsync: vi.fn(),
    isAddingServer: false,
  }),
}))

vi.mock('@/api/mcp', () => ({
  mcpApi: { removeServer: mockRemoveServer, startAuth: vi.fn(), getStatus: vi.fn() },
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: mockToastError, info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

const config = {
  content: {
    mcp: {
      servers: {
        configured: { type: 'local', command: ['npx', 'server'] },
      },
    },
  },
}

function renderManager(onUpdate: (content: Record<string, unknown>) => Promise<void>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <McpManager config={config} onUpdate={onUpdate} />
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
    renderManager(vi.fn())

    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.getByText('Legacy server')).toBeInTheDocument()
  })

  it('removes only the mcp.servers entry when deleting a configured server', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderManager(onUpdate)

    await deleteServer(user, 'Configured')

    await waitFor(() => expect(mockRemoveServer).toHaveBeenCalledWith('configured'))
    expect(onUpdate).toHaveBeenCalledWith({ mcp: { servers: {} } })
  })

  it('skips the config update for a server that is not in mcp.servers', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderManager(onUpdate)

    await deleteServer(user, 'Legacy server')

    await waitFor(() => expect(mockRemoveServer).toHaveBeenCalledWith('legacy-server'))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('surfaces the shadowed-removal message from the backend', async () => {
    const message = 'Cannot remove mcp.servers.configured: defined in opencode.json, not in opencode.jsonc'
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockRejectedValue(new FetchError(message, 409))
    const user = userEvent.setup()
    renderManager(onUpdate)

    await deleteServer(user, 'Configured')

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(message))
    expect(mockRemoveServer).not.toHaveBeenCalled()
  })
})
