import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'
import { OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

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

vi.mock('@/hooks/useOpenCode', () => ({
  useAgents: () => ({ data: [] }),
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

const config = makeOpenCodeConfigFile()

describe('ScheduleJobDialog — shared config query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvidersWithModels.mockResolvedValue([])
    mockGetOpenCodeConfig.mockResolvedValue(config)
  })

  it('feeds the cached shared config into the provider listing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryDefaults(OPEN_CODE_CONFIG_QUERY_KEY, { staleTime: Infinity })
    queryClient.setQueryData(OPEN_CODE_CONFIG_QUERY_KEY, config)

    render(
      <ScheduleJobDialog
        open
        onOpenChange={vi.fn()}
        showRepoSelector
        repoId={undefined}
        onRepoChange={vi.fn()}
        onSubmit={vi.fn()}
        isSaving={false}
      />,
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    )

    await waitFor(() => expect(mockGetProvidersWithModels).toHaveBeenCalled())
    expect(mockGetProvidersWithModels).toHaveBeenCalledWith(undefined, config)
    expect(mockGetOpenCodeConfig).not.toHaveBeenCalled()
  })
})
