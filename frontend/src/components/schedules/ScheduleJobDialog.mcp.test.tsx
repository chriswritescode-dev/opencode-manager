import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  renderScheduleJobDialog,
  makeMcpServer,
  makeScheduleJobFixture,
} from '@/test/scheduleJobDialog'
import { makeRepo } from '@/test/fixtures/api'

describe('ScheduleJobDialog — MCP servers', () => {
  it('lists servers from the schedule directory and submits configured and schedule-only servers', async () => {
    const user = userEvent.setup()
    const dialog = await renderScheduleJobDialog({
      job: makeScheduleJobFixture({
        repoId: 1,
        name: 'Test Job',
        prompt: 'Test prompt',
        mcpServers: [
          { name: 'github' },
          { name: 'old-remote', config: { type: 'remote', url: 'https://old.example.com/mcp' } },
        ],
      }),
      repos: [makeRepo({ id: 1, fullPath: '/workspace/repos/sample' })],
      mcpServers: [makeMcpServer('github', 'disabled'), makeMcpServer('linear', 'connected')],
    })

    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    await waitFor(() =>
      expect(dialog.fetchFake.lastRequest('GET', '/api/opencode/api/mcp')?.searchParams.get('location[directory]')).toBe(
        '/workspace/repos/sample',
      ),
    )
    expect(await screen.findByText('old-remote')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove old-remote' }))
    await user.click(screen.getByRole('button', { name: 'Add server' }))
    const addDialog = await screen.findByRole('dialog', { name: 'Add MCP Server' })
    expect(within(addDialog).queryByLabelText('Connect immediately after adding')).not.toBeInTheDocument()
    await user.type(within(addDialog).getByLabelText('Server ID'), 'filesystem')
    await user.type(within(addDialog).getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(within(addDialog).getByRole('button', { name: 'Add MCP Server' }))

    expect(await screen.findByText('filesystem')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(dialog.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mcpServers: [
        { name: 'github' },
        { name: 'filesystem', config: { type: 'local', command: ['npx', 'server-filesystem', '/tmp'] } },
      ],
    }))
  })

  it('offers the servers reported for the schedule directory', async () => {
    const user = userEvent.setup()
    await renderScheduleJobDialog({
      job: makeScheduleJobFixture({ repoId: 1 }),
      repoId: 1,
      mcpServers: [makeMcpServer('github', 'disabled'), makeMcpServer('linear', 'connected')],
    })

    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    await user.click(await screen.findByText('Search and select MCP servers...'))

    expect(await screen.findByText('Currently connected')).toBeInTheDocument()
    expect(screen.getByText('Currently disabled')).toBeInTheDocument()
  })
})
