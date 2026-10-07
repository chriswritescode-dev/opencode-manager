import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import type { Provider } from '@/api/providers'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import type { ScheduleJob } from '@opencode-manager/shared/types'

Element.prototype.scrollIntoView = vi.fn()

const {
  mockGetProviders,
  mockGetOpenCodeConfiguredModel,
  mockGetOpenCodeServerDefaultModel,
  mockGetOpenCodeModelState,
} = vi.hoisted(() => ({
  mockGetProviders: vi.fn(),
  mockGetOpenCodeConfiguredModel: vi.fn(),
  mockGetOpenCodeServerDefaultModel: vi.fn(),
  mockGetOpenCodeModelState: vi.fn(),
}))

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: [], isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/api/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/providers')>()),
  getProviders: mockGetProviders,
  getOpenCodeConfiguredModel: mockGetOpenCodeConfiguredModel,
  getOpenCodeServerDefaultModel: mockGetOpenCodeServerDefaultModel,
  getOpenCodeModelState: mockGetOpenCodeModelState,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useAgents: () => ({ data: [] }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    listManagedSkills: () => Promise.resolve([]),
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: () => Promise.resolve([]),
  listBranches: () => Promise.resolve({ branches: [], status: { ahead: 0, behind: 0 } }),
}))

const providers: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [{ id: 'gpt-5', key: 'gpt-5', name: 'GPT-5', released: 0, free: false }],
  },
]

const models = [{ providerID: 'openai', id: 'gpt-5' }] as unknown as ModelInfo[]

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
    mockGetProviders.mockResolvedValue({ providers, models })
    mockGetOpenCodeConfiguredModel.mockResolvedValue(null)
    mockGetOpenCodeServerDefaultModel.mockResolvedValue(null)
    mockGetOpenCodeModelState.mockResolvedValue({ recent: [], favorite: [], variant: {} })
  })

  it('leaves the model at the workspace default when the stored model no longer exists', async () => {
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

    await waitFor(() => expect(screen.queryByDisplayValue('openai/retired')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('Workspace default')).toBeInTheDocument()
  })

  it('saves no model override for a stale model', async () => {
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

    await waitFor(() => expect(screen.queryByDisplayValue('openai/retired')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].model).toBeUndefined()
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

  it('treats a stored backing model id as unavailable', async () => {
    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        job={getJob({ model: 'openai/gpt-5-2025-08-07' })}
        isSaving={false}
        onSubmit={vi.fn()}
        repoId={1}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(screen.queryByDisplayValue('openai/gpt-5-2025-08-07')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('Workspace default')).toBeInTheDocument()
  })

  it('keeps a stored model when the catalog is confirmed empty', async () => {
    mockGetProviders.mockResolvedValue({ providers: [], models: [] })

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

    await waitFor(() => expect(screen.getByDisplayValue('openai/retired')).toBeInTheDocument())
  })

  it('shows Default from OpenCode when no model is configured', async () => {
    const user = userEvent.setup()
    mockGetProviders.mockResolvedValue({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: [
            { id: 'gpt-5', key: 'gpt-5', name: 'GPT-5', released: 0, free: false },
            { id: 'gpt-4o', key: 'gpt-4o', name: 'GPT-4o', released: 0, free: false },
          ],
        },
      ],
      models: [
        { providerID: 'openai', id: 'gpt-5' },
        { providerID: 'openai', id: 'gpt-4o' },
      ] as unknown as ModelInfo[],
    })
    mockGetOpenCodeServerDefaultModel.mockResolvedValue({ providerID: 'openai', id: 'gpt-5' })

    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        job={getJob()}
        isSaving={false}
        onSubmit={vi.fn()}
        repoId={1}
      />,
      { wrapper: createWrapper() },
    )

    const modelInput = await screen.findByPlaceholderText('Workspace default')
    await user.click(modelInput)

    const listbox = await screen.findByRole('listbox')
    const defaultGroup = within(listbox).getByText('Default')
    const providerGroup = within(listbox).getByText('OpenAI')
    expect(within(listbox).getByText('Default: GPT-5')).toBeInTheDocument()
    expect(defaultGroup.compareDocumentPosition(providerGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
