import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'
import type { ProviderWithModels } from '@/api/providers'
import type { ScheduleJob } from '@opencode-manager/shared/types'

Element.prototype.scrollIntoView = vi.fn()

const { mockGetProvidersWithModels, mockGetOpenCodeConfig } = vi.hoisted(() => ({
  mockGetProvidersWithModels: vi.fn(),
  mockGetOpenCodeConfig: vi.fn(),
}))

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: [], isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/api/providers', () => ({
  getProvidersWithModels: mockGetProvidersWithModels,
}))

vi.mock('@/api/opencode', () => ({
  createOpenCodeClient: () => ({
    listAgents: () => Promise.resolve([]),
    getConfig: () => Promise.resolve(null),
  }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
    listManagedSkills: () => Promise.resolve([]),
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: () => Promise.resolve([]),
  listBranches: () => Promise.resolve({ branches: [], status: { ahead: 0, behind: 0 } }),
}))

const providers: ProviderWithModels[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: [{ id: 'gpt-5', key: 'gpt-5', name: 'GPT-5' }],
    source: 'configured',
    isConnected: true,
  },
]

const config = makeOpenCodeConfigFile({ content: { model: 'openai/gpt-5' } })

function getJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
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
    branch: null,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  }
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

describe('ScheduleJobDialog — model fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvidersWithModels.mockResolvedValue(providers)
    mockGetOpenCodeConfig.mockResolvedValue(config)
  })

  it('prefills the config default when the stored model no longer exists', async () => {
    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        job={getJob({ model: 'openai/retired' })}
        isSaving={false}
        onSubmit={vi.fn()}
        repoId={1}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(screen.getByDisplayValue('GPT-5')).toBeInTheDocument())
  })

  it('saves the resolved config default for a stale model', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        job={getJob({ model: 'openai/retired' })}
        isSaving={false}
        onSubmit={onSubmit}
        repoId={1}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(screen.getByDisplayValue('GPT-5')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5' }))
  })

  it('keeps a stored model that is still available', async () => {
    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        job={getJob({ model: 'openai/gpt-5' })}
        isSaving={false}
        onSubmit={vi.fn()}
        repoId={1}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(screen.getByDisplayValue('GPT-5')).toBeInTheDocument())
  })
})
