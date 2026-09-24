import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { McpServerCard } from './McpServerCard'
import type { McpServerConfig, McpStatus } from '@/api/mcp'

const serverId = 'my-test-server'
const serverConfig: McpServerConfig = { type: 'remote', url: 'https://example.com/mcp' }
const status: McpStatus = { status: 'connected' }

describe('McpServerCard', () => {
  it('renders display name and description', () => {
    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={status}
        isConnected={true}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('My test server')).toBeInTheDocument()
    expect(screen.getByText('Remote server: https://example.com/mcp')).toBeInTheDocument()
  })

  it('renders the Connected status badge', () => {
    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={status}
        isConnected={true}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders the toggle Switch when not awaiting auth', () => {
    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={status}
        isConnected={true}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onDeleteServer when Delete Server is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onDeleteServer = vi.fn()

    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={status}
        isConnected={true}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={onDeleteServer}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Actions for My test server'))
    await user.click(screen.getByText('Delete Server'))

    expect(onDeleteServer).toHaveBeenCalledTimes(1)
    expect(onDeleteServer).toHaveBeenCalledWith('my-test-server', 'My test server')
  })

  it('renders the Connecting badge for a pending server', () => {
    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={{ status: 'pending' }}
        isConnected={false}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('Connecting')).toBeInTheDocument()
  })

  it('offers auth for an OAuth integration even without an error message', () => {
    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={{ status: 'failed', error: 'MCP error -32000', integrationID: 'int-1' }}
        isConnected={false}
        errorMessage="MCP error -32000"
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Auth/ })).toBeInTheDocument()
  })

  it('offers remove auth for a connected OAuth integration', async () => {
    const user = userEvent.setup()
    const onRemoveAuth = vi.fn()

    render(
      <McpServerCard
        serverId={serverId}
        serverConfig={serverConfig}
        status={{ status: 'connected', integrationID: 'int-1' }}
        isConnected={true}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={onRemoveAuth}
      />,
    )

    await user.click(screen.getByLabelText('Actions for My test server'))
    await user.click(screen.getByText('Remove Auth'))

    expect(onRemoveAuth).toHaveBeenCalledWith('my-test-server')
  })
})
