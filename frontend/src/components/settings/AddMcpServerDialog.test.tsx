import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

const {
  mockGetOpenCodeConfig,
  mockUpdateOpenCodeConfig,
  mockAddServerAsync,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockAddServerAsync: vi.fn(),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
  },
}))

vi.mock('@/hooks/useMcpServers', () => ({
  useMcpServers: () => ({ addServerAsync: mockAddServerAsync, isAddingServer: false }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

const config = makeOpenCodeConfigFile()

function renderDialog(onUpdate: (content: Record<string, unknown>) => Promise<void>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AddMcpServerDialog open onOpenChange={vi.fn()} onUpdate={onUpdate} />
    </QueryClientProvider>,
  )
}

describe('AddMcpServerDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeConfig.mockResolvedValue(config)
    mockUpdateOpenCodeConfig.mockResolvedValue(config)
    mockAddServerAsync.mockResolvedValue(undefined)
  })

  it('issues exactly one config update through the owner callback and never writes directly', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith({
      mcp: {
        servers: {
          filesystem: {
            type: 'local',
            command: ['npx', 'server-filesystem', '/tmp'],
            disabled: false,
          },
        },
      },
    })
    expect(mockAddServerAsync).toHaveBeenCalledTimes(1)
  })

  it('writes a remote server with V2 OAuth keys and the Manager callback', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    await user.type(screen.getByLabelText('Server ID'), 'remote-tools')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Remote (HTTP)' }))
    await user.type(screen.getByLabelText('Server URL'), 'https://mcp.example.com')
    await user.click(screen.getByLabelText('Enable OAuth'))
    await user.type(screen.getByLabelText('Client ID'), 'client-1')
    await user.type(screen.getByLabelText('Timeout (ms)'), '9000')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const serverConfig = {
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: {
        client_id: 'client-1',
        redirect_uri: `${window.location.origin}/api/mcp-oauth-proxy/callback`,
      },
      disabled: false,
      timeout: { catalog: 9000, execution: 9000 },
    }
    expect(onUpdate).toHaveBeenCalledWith({ mcp: { servers: { 'remote-tools': serverConfig } } })
    expect(mockAddServerAsync).toHaveBeenCalledWith({ name: 'remote-tools', config: serverConfig })
  })

  it('passes only the merged content to onUpdate', async () => {
    const fetched = makeOpenCodeConfigFile({ revision: 'rev-B' })
    mockGetOpenCodeConfig.mockResolvedValue(fetched)
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const [content] = onUpdate.mock.calls[0]
    expect(onUpdate.mock.calls[0]).toHaveLength(1)
    const mcp = content.mcp as Record<string, unknown>
    expect(mcp.servers).toBeDefined()
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
  })
})
