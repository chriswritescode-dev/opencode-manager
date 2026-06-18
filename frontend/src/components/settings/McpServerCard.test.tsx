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
})
