import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RepoMcpContent } from './RepoMcpDialog'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  removeAuth: vi.fn(),
  startAuth: vi.fn(),
}))

vi.mock('@/api/mcp', () => ({ mcpApi: mocks }))

vi.mock('@/components/settings/McpOAuthDialog', () => ({
  McpOAuthDialog: () => <div data-testid="mcp-oauth-dialog" />,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

function renderContent(serverId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OpenCodeServerProvider serverId={serverId}>{children}</OpenCodeServerProvider>
    </QueryClientProvider>
  )
  return render(<RepoMcpContent open directory="/home/me/app" />, { wrapper })
}

describe('RepoMcpContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads MCP status from the linked server for the session directory', async () => {
    mocks.getStatus.mockResolvedValue({
      server: { status: 'connected', integrationID: 'int_1' },
    })

    renderContent('srv_kitchen')

    await waitFor(() => {
      expect(mocks.getStatus).toHaveBeenCalledWith('/home/me/app', 'srv_kitchen')
    })
  })

  it('connects and disconnects MCP servers against the linked server', async () => {
    mocks.getStatus.mockResolvedValue({ server: { status: 'connected' } })
    mocks.disconnect.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderContent('srv_kitchen')

    const toggle = await screen.findByRole('switch')
    await user.click(toggle)

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledWith('server', '/home/me/app', 'srv_kitchen')
    })
  })

  it('hides every Manager OAuth action for a linked server', async () => {
    mocks.getStatus.mockResolvedValue({
      server: { status: 'connected', integrationID: 'int_1' },
      authServer: { status: 'needs_auth', error: 'auth required', integrationID: 'int_2' },
    })

    renderContent('srv_kitchen')

    await screen.findByText('Auth Required')

    expect(screen.queryByTitle('Click for options')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auth' })).not.toBeInTheDocument()
    expect(screen.queryByText('Re-authenticate')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove Auth')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mcp-oauth-dialog')).not.toBeInTheDocument()
    expect(mocks.removeAuth).not.toHaveBeenCalled()
    expect(mocks.startAuth).not.toHaveBeenCalled()
  })

  it('keeps the Manager OAuth actions for the local server', async () => {
    mocks.getStatus.mockResolvedValue({
      server: { status: 'connected', integrationID: 'int_1' },
    })
    const user = userEvent.setup()

    renderContent('local')

    expect(await screen.findByTestId('mcp-oauth-dialog')).toBeInTheDocument()

    await user.click(screen.getByTitle('Click for options'))

    expect(await screen.findByText('Re-authenticate')).toBeInTheDocument()
    expect(screen.getByText('Remove Auth')).toBeInTheDocument()
  })
})
