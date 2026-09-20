import { describe, it, expect, vi, beforeEach } from 'vitest'
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
        filesystem: {
          type: 'local',
          enabled: true,
          command: ['npx', 'server-filesystem', '/tmp'],
        },
      },
    })
    expect(mockAddServerAsync).toHaveBeenCalledTimes(1)
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
    expect((content.mcp as Record<string, unknown>).filesystem).toBeDefined()
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
  })
})
