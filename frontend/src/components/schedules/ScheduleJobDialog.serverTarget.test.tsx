import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import { ScheduleJobDialog } from './ScheduleJobDialog'

Element.prototype.scrollIntoView = vi.fn()

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: [], isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useScheduleTarget', () => ({
  useScheduleTarget: () => ({ scheduleTarget: undefined, isLoading: false, isError: false }),
}))

vi.mock('@/hooks/useScheduleModels', () => ({
  useScheduleModels: () => ({ availableModels: null, isLoading: false }),
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useAgents: () => ({ data: [], isSuccess: true }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    listManagedSkills: () => Promise.resolve([]),
  },
}))

vi.mock('@/api/mcp', () => ({
  mcpApi: {
    getStatus: () => Promise.resolve({}),
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: () => Promise.resolve([]),
}))

const remoteJob: ScheduleJob = {
  id: 7,
  repoId: null,
  serverId: 'srv_kitchen',
  directory: '/srv/projects/audit',
  name: 'Nightly audit',
  description: null,
  enabled: true,
  scheduleMode: 'interval',
  intervalMinutes: 60,
  cronExpression: null,
  timezone: null,
  agentSlug: null,
  prompt: 'Audit the project.',
  model: null,
  skillMetadata: null,
  permissionConfig: null,
  mcpServers: [],
  branch: null,
  workspaceMode: 'in-place',
  sandbox: null,
  createdAt: 0,
  updatedAt: 0,
  lastRunAt: null,
  nextRunAt: null,
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ScheduleJobDialog — server target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides worktree workspace mode and submits an in-place target directory', async () => {
    const onSubmit = vi.fn()

    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        isSaving={false}
        job={remoteJob}
        serverTarget={{ serverId: 'srv_kitchen', directory: '/srv/projects/audit' }}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('Edit schedule')).toBeInTheDocument()
    })

    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Base branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Fresh worktree, cleaned up')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        workspaceMode: 'in-place',
        directory: '/srv/projects/audit',
        branch: null,
      }))
    })
  })
})
