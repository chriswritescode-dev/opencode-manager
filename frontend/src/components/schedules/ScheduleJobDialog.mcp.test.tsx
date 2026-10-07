import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import type { ScheduleJob } from '@opencode-manager/shared/types'

Element.prototype.scrollIntoView = vi.fn()

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}))

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: [], isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/api/providers', () => ({
  getProviders: () => Promise.resolve({ providers: [], models: [] }),
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useAgents: () => ({ data: [] }),
}))

vi.mock('@/hooks/useScheduleTarget', () => ({
  useScheduleTarget: () => ({ scheduleTarget: { fullPath: '/workspace/repos/sample' } }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    listManagedSkills: () => Promise.resolve([]),
  },
}))

vi.mock('@/api/mcp', () => ({
  mcpApi: { getStatus: mocks.getStatus },
}))

vi.mock('@/api/repos', () => ({
  listRepos: () => Promise.resolve([]),
  listBranches: () => Promise.resolve({ branches: [], status: { ahead: 0, behind: 0 } }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const job: ScheduleJob = {
  id: 1,
  repoId: 1,
  name: 'Test Job',
  description: null,
  enabled: true,
  scheduleMode: 'interval',
  intervalMinutes: 60,
  cronExpression: null,
  timezone: null,
  agentSlug: null,
  prompt: 'Test prompt',
  model: null,
  skillMetadata: null,
  permissionConfig: null,
  mcpServers: [
    { name: 'github' },
    { name: 'old-remote', config: { type: 'remote', url: 'https://old.example.com/mcp' } },
  ],
  branch: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastRunAt: null,
  nextRunAt: null,
}

describe('ScheduleJobDialog — MCP servers', () => {
  it('lists servers from the schedule directory and submits configured and schedule-only servers', async () => {
    mocks.getStatus.mockResolvedValue({ github: { status: 'disabled' }, linear: { status: 'connected' } })
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(<ScheduleJobDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isSaving={false} job={job} />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledWith('/workspace/repos/sample'))
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

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mcpServers: [
        { name: 'github' },
        { name: 'filesystem', config: { type: 'local', command: ['npx', 'server-filesystem', '/tmp'] } },
      ],
    }))
  })
})
