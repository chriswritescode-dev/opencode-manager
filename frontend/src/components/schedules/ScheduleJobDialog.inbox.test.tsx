import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import { useSettings } from '@/hooks/useSettings'
import { useServerHealth } from '@/hooks/useServerHealth'
import { createUseSettingsMock } from '@/test/test-utils'

Element.prototype.scrollIntoView = vi.fn()

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useServerHealth')

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
  listBranches: () => Promise.resolve({ branches: [], status: { ahead: 0, behind: 0 } }),
}))

function mockSandboxPreferences() {
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({ preferences: { sandbox: { enabled: true } } }),
  )
}

function mockSandboxHealth() {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { sandbox: { available: true, enabled: true, enforced: false } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useServerHealth>)
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

function getJob(overrides?: Partial<ScheduleJob>): ScheduleJob {
  return {
    id: 1,
    repoId: 1,
    name: 'Nightly health check',
    description: null,
    enabled: true,
    showInInbox: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Check the repo.',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: null,
    workspaceMode: 'worktree',
    sandbox: null,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  }
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Nightly health check')
  await user.click(screen.getByRole('tab', { name: 'Prompt' }))
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Check the repo.')
}

async function goToGeneralTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'General' }))
}

describe('ScheduleJobDialog — inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSandboxPreferences()
    mockSandboxHealth()
  })

  it('submits showInInbox true by default for a new schedule', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isSaving={false} />,
      { wrapper: createWrapper() },
    )

    await fillRequiredFields(user)
    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Show runs in inbox' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit.mock.calls[0][0].showInInbox).toBe(true)
  })

  it('submits showInInbox false when the inbox switch is turned off', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isSaving={false} />,
      { wrapper: createWrapper() },
    )

    await fillRequiredFields(user)
    await goToGeneralTab(user)

    await user.click(screen.getByRole('switch', { name: 'Show runs in inbox' }))
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit.mock.calls[0][0].showInInbox).toBe(false)
  })

  it('keeps showInInbox false from an existing job when the switch is untouched', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <ScheduleJobDialog open onOpenChange={vi.fn()} job={getJob({ showInInbox: false })} onSubmit={onSubmit} isSaving={false} />,
      { wrapper: createWrapper() },
    )

    await goToGeneralTab(user)

    expect(screen.getByRole('switch', { name: 'Show runs in inbox' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit.mock.calls[0][0].showInInbox).toBe(false)
  })
})
