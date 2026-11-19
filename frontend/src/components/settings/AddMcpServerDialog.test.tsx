import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { McpServerConfig } from '@opencode-manager/shared/opencode'
import { installPointerCapture } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { AddMcpServerDialog } from './AddMcpServerDialog'

type SubmitHandler = (serverId: string, config: McpServerConfig) => Promise<void>

function renderDialog(onSubmit: SubmitHandler, showConnectToggle?: boolean) {
  installPointerCapture()
  return renderWithProviders(
    <AddMcpServerDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} showConnectToggle={showConnectToggle} />,
    { auth: false, theme: false, tts: false, toaster: false },
  )
}

describe('AddMcpServerDialog', () => {
  it('submits the server ID and a local server config exactly once', async () => {
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onSubmit)

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('filesystem', {
      type: 'local',
      command: ['npx', 'server-filesystem', '/tmp'],
      disabled: false,
    })
  })

  it('submits a remote server with V2 OAuth keys and the Manager callback', async () => {
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onSubmit)

    await user.type(screen.getByLabelText('Server ID'), 'remote-tools')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Remote (HTTP)' }))
    await user.type(screen.getByLabelText('Server URL'), 'https://mcp.example.com')
    await user.click(screen.getByLabelText('Enable OAuth'))
    await user.type(screen.getByLabelText('Client ID'), 'client-1')
    await user.type(screen.getByLabelText('Timeout (ms)'), '9000')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('remote-tools', {
      type: 'remote',
      url: 'https://mcp.example.com',
      oauth: {
        client_id: 'client-1',
        redirect_uri: `${window.location.origin}/api/mcp-oauth-proxy/callback`,
      },
      disabled: false,
      timeout: { catalog: 9000, execution: 9000 },
    })
  })

  it('submits a remote server with bearer headers and OAuth turned off', async () => {
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onSubmit)

    await user.type(screen.getByLabelText('Server ID'), 'token-tools')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Remote (HTTP)' }))
    await user.type(screen.getByLabelText('Server URL'), 'https://mcp.example.com/mcp')
    await user.click(screen.getByRole('button', { name: 'Add Headers' }))
    await user.type(screen.getByLabelText('Headers name 1'), 'Authorization')
    await user.type(screen.getByLabelText('Headers value 1'), 'Bearer secret-token')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('token-tools', {
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer secret-token' },
      oauth: false,
      disabled: false,
    })
  })

  it('hides the connect toggle when the caller controls connection', () => {
    renderDialog(vi.fn<SubmitHandler>(), false)

    expect(screen.queryByLabelText('Connect immediately after adding')).not.toBeInTheDocument()
  })
})
