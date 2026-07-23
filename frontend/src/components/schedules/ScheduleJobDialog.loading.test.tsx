import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScheduleJobDialog } from './ScheduleJobDialog'

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// Reproduces the "Maximum update depth exceeded" crash: while the prompt
// templates query is loading, the hook returns `data: undefined`. The
// component's `= EMPTY_TEMPLATES` fallback must stay referentially stable so
// the init effect does not re-fire every render.
vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: undefined, isLoading: true }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/api/providers', () => ({
  getProvidersWithModels: () => Promise.resolve([]),
}))

vi.mock('@/api/opencode', () => ({
  createOpenCodeClient: () => ({
    listAgents: () => Promise.resolve([]),
    getConfig: () => Promise.resolve(null),
  }),
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

describe('ScheduleJobDialog — templates loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without an infinite render loop while templates are loading', async () => {
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
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('New schedule')).toBeInTheDocument()
    })
  })
})
