import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MultiRunDialog } from './MultiRunDialog'
import type { MultiRun } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  listMultiRuns: vi.fn(),
  launchMultiRun: vi.fn(),
  discardMultiRunEntry: vi.fn(),
  fuseMultiRun: vi.fn(),
  useProvidersWithModels: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  listBranches: vi.fn(),
  getChangeWalkthrough: vi.fn(),
  generateChangeWalkthrough: vi.fn(),
}))

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal('react-router-dom')),
  useNavigate: () => mockNavigate,
}))

vi.mock('@/api/multiRuns', () => ({
  listMultiRuns: mocks.listMultiRuns,
  launchMultiRun: mocks.launchMultiRun,
  discardMultiRunEntry: mocks.discardMultiRunEntry,
  fuseMultiRun: mocks.fuseMultiRun,
}))

vi.mock('@/hooks/useProvidersWithModels', () => ({
  useProvidersWithModels: mocks.useProvidersWithModels,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
}))

vi.mock('@/api/repos', () => ({
  listBranches: mocks.listBranches,
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const providers = [
  {
    id: 'openai',
    name: 'OpenAI',
    source: 'configured',
    isConnected: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    source: 'configured',
    isConnected: true,
    models: [
      { id: 'claude-opus', name: 'Claude Opus' },
      { id: 'claude-sonnet', name: 'Claude Sonnet' },
      { id: 'claude-haiku', name: 'Claude Haiku' },
      { id: 'claude-sonnet-4-5', key: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    ],
  },
]

const startedRun: MultiRun = {
  id: 3,
  repoId: 7,
  name: 'Sweep',
  prompt: 'go',
  isolated: true,
  baseRef: 'main',
  createdAt: 1,
  entries: [
    {
      id: 11,
      model: 'openai/gpt-4o',
      status: 'started',
      sessionId: 'ses_1',
      directory: '/workspaces/sweep-1',
      isolated: true,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 12,
      model: 'anthropic/claude-opus',
      status: 'failed',
      sessionId: null,
      directory: null,
      isolated: true,
      error: 'launch failed',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  fusions: [],
}

const twoStartedRun: MultiRun = {
  ...startedRun,
  id: 5,
  name: 'Pair',
  entries: [
    startedRun.entries[0],
    {
      id: 13,
      model: 'anthropic/claude-opus',
      status: 'started',
      sessionId: 'ses_2',
      directory: '/workspaces/sweep-2',
      isolated: true,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}

const fusedRun: MultiRun = {
  id: 4,
  repoId: 7,
  name: 'Merged',
  prompt: 'go',
  isolated: true,
  baseRef: 'main',
  createdAt: 1,
  entries: [
    {
      id: 21,
      model: 'openai/gpt-4o',
      status: 'discarded',
      sessionId: null,
      directory: null,
      isolated: true,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  fusions: [
    {
      id: 31,
      requestId: 'req-1',
      model: 'openai/gpt-4o',
      instructions: null,
      isolated: true,
      baseRef: 'main',
      status: 'started',
      sessionId: 'ses_fusion',
      directory: '/workspaces/fusion',
      error: null,
      sources: [{ entryId: 21, sessionId: 'ses_1', model: 'openai/gpt-4o', truncated: true }],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof MultiRunDialog>> = {}) {
  return render(
    <MultiRunDialog
      repoId={7}
      directory="/repo"
      defaultBaseRef="main"
      open
      onOpenChange={vi.fn()}
      {...overrides}
    />,
    { wrapper: createWrapper() },
  )
}

function checkboxLabels() {
  return screen.getAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label'))
}

async function fillLaunchForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Group name'), 'Sweep')
  await user.type(screen.getByLabelText('Prompt'), 'go')
  await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
}

describe('MultiRunDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProvidersWithModels.mockReturnValue({ data: providers, isLoading: false })
    mocks.useOpenCodeModelState.mockReturnValue({ data: { recent: [], favorite: [], variant: {} } })
    mocks.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', type: 'local', current: true },
        { name: 'remotes/origin/HEAD', type: 'remote', current: false },
        { name: 'remotes/origin/release', type: 'remote', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
    mocks.listMultiRuns.mockResolvedValue([])
    mocks.getChangeWalkthrough.mockResolvedValue({ walkthrough: null, currentDiffHash: null, stale: false })
  })

  it('lists favorite then recent models before provider groups without duplicates', () => {
    mocks.useOpenCodeModelState.mockReturnValue({
      data: {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [
          { providerID: 'openai', modelID: 'gpt-4.1' },
          { providerID: 'anthropic', modelID: 'claude-sonnet' },
          { providerID: 'missing', modelID: 'gone' },
        ],
        variant: {},
      },
    })
    renderDialog()

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(checkboxLabels()).toEqual([
      'Claude Sonnet',
      'GPT-4.1',
      'GPT-4o',
      'GPT-4o mini',
      'Claude Opus',
      'Claude Haiku',
      'Claude Sonnet 4.5',
    ])
  })

  it('filters models by every search term and keeps favorites first', async () => {
    const user = userEvent.setup()
    mocks.useOpenCodeModelState.mockReturnValue({
      data: { favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4.5' }], recent: [], variant: {} },
    })
    renderDialog()

    await user.type(screen.getByLabelText('Search models'), 'sonnet')
    await waitFor(() => expect(checkboxLabels()).toEqual(['Claude Sonnet 4.5', 'Claude Sonnet']))

    await user.clear(screen.getByLabelText('Search models'))
    await user.type(screen.getByLabelText('Search models'), 'anthropic haiku')
    await waitFor(() => expect(checkboxLabels()).toEqual(['Claude Haiku']))

    await user.type(screen.getByLabelText('Search models'), 'zzz')
    expect(await screen.findByText('No models match your search.')).toBeInTheDocument()
  })

  it('keeps selections that are hidden by the search filter', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
    await user.type(screen.getByLabelText('Search models'), 'claude')

    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'GPT-4o' })).not.toBeInTheDocument())
    expect(screen.getByText('1/5 selected')).toBeInTheDocument()
  })

  it('submits the selected remote branch as the base ref', async () => {
    const user = userEvent.setup()
    mocks.launchMultiRun.mockResolvedValue(startedRun)
    renderDialog()

    await fillLaunchForm(user)
    const branchSelect = screen.getByRole('combobox', { name: 'Start from' })
    await waitFor(() => expect(branchSelect).toBeEnabled())
    await user.click(branchSelect)
    expect(screen.queryByRole('option', { name: /HEAD/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /release/ }))
    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(mocks.launchMultiRun).toHaveBeenCalledWith({
        repoId: 7,
        name: 'Sweep',
        prompt: 'go',
        models: ['openai/gpt-4o'],
        isolate: true,
        baseRef: 'origin/release',
      })
    })
  })

  it('hides the base branch and omits it when runs are not isolated', async () => {
    const user = userEvent.setup()
    mocks.launchMultiRun.mockResolvedValue(startedRun)
    renderDialog()

    await fillLaunchForm(user)
    await user.click(screen.getByRole('switch', { name: 'Isolate runs' }))
    expect(screen.queryByRole('combobox', { name: 'Start from' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(mocks.launchMultiRun).toHaveBeenCalledWith({
        repoId: 7,
        name: 'Sweep',
        prompt: 'go',
        models: ['openai/gpt-4o'],
        isolate: false,
      })
    })
  })

  it('caps model selection at five', async () => {
    const user = userEvent.setup()
    renderDialog()

    const names = ['GPT-4o', 'GPT-4o mini', 'GPT-4.1', 'Claude Opus', 'Claude Sonnet']
    for (const name of names) {
      await user.click(screen.getByRole('checkbox', { name }))
    }

    expect(screen.getByText('5/5 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Claude Haiku' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Claude Haiku' }))
    expect(screen.getByText('5/5 selected')).toBeInTheDocument()
  })

  it('submits the launch request', async () => {
    const user = userEvent.setup()
    mocks.launchMultiRun.mockResolvedValue(startedRun)
    renderDialog()

    await user.type(screen.getByLabelText('Group name'), 'Sweep')
    await user.type(screen.getByLabelText('Prompt'), 'go')
    await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(mocks.launchMultiRun).toHaveBeenCalledWith({
        repoId: 7,
        name: 'Sweep',
        prompt: 'go',
        models: ['openai/gpt-4o'],
        isolate: true,
        baseRef: 'main',
      })
    })
  })

  it('keeps the launch tab when the launch request fails', async () => {
    const user = userEvent.setup()
    mocks.launchMultiRun.mockRejectedValue(new Error('launch failed'))
    renderDialog()

    await user.type(screen.getByLabelText('Group name'), 'Sweep')
    await user.type(screen.getByLabelText('Prompt'), 'go')
    await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(mocks.launchMultiRun).toHaveBeenCalled()
    })
    expect(screen.getByLabelText('Group name')).toBeInTheDocument()
    expect(screen.queryByText('No runs yet.')).not.toBeInTheDocument()
  })

  it('submits the catalog id for configured model aliases', async () => {
    const user = userEvent.setup()
    mocks.launchMultiRun.mockResolvedValue(startedRun)
    renderDialog()

    await user.type(screen.getByLabelText('Group name'), 'Sweep')
    await user.type(screen.getByLabelText('Prompt'), 'go')
    await user.click(screen.getByRole('checkbox', { name: 'Claude Sonnet 4.5' }))
    await user.click(screen.getByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(mocks.launchMultiRun).toHaveBeenCalledWith({
        repoId: 7,
        name: 'Sweep',
        prompt: 'go',
        models: ['anthropic/claude-sonnet-4.5'],
        isolate: true,
        baseRef: 'main',
      })
    })
  })

  it('lists run entries with Open and Discard actions', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([startedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))

    await waitFor(() => {
      expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument()
    })
    expect(screen.getByText('launch failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /discard/i })).toHaveLength(2)
  })

  it('opens a started run in the workspaces tab', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([startedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /open/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_1?repoTab=workspaces')
  })

  it('discards an entry after confirmation', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([startedRun])
    mocks.discardMultiRunEntry.mockResolvedValue(startedRun)
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /discard/i })).toHaveLength(2)
    })

    await user.click(screen.getAllByRole('button', { name: /discard/i })[0])

    const confirmDialog = await screen.findByRole('dialog', { name: 'Discard run' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Discard' }))

    await waitFor(() => {
      expect(mocks.discardMultiRunEntry).toHaveBeenCalledWith(3, 11)
    })
  })

  it('disables Fuse for runs with fewer than two started entries', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([startedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /fuse/i })).toBeDisabled()
  })

  it('opens the fuse dialog for a run with two started entries', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([twoStartedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    const fuseButton = await screen.findByRole('button', { name: /fuse/i })
    expect(fuseButton).toBeEnabled()
    await user.click(fuseButton)

    expect(await screen.findByRole('dialog', { name: 'Fuse results' })).toBeInTheDocument()
  })

  it('lists fusions with truncation and opens the fusion session', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([fusedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => expect(screen.getByText('Fusions')).toBeInTheDocument())
    expect(screen.getByText('from 1 source (truncated)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_fusion?repoTab=workspaces')
  })

  it('opens the walkthrough dialog for an entry session', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([startedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /walkthrough/i }))

    expect(await screen.findByText('Change walkthrough')).toBeInTheDocument()
    await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1'))
  })

  it('opens the walkthrough dialog for a fusion session', async () => {
    const user = userEvent.setup()
    mocks.listMultiRuns.mockResolvedValue([fusedRun])
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Runs' }))
    await waitFor(() => expect(screen.getByText('Fusions')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /walkthrough/i }))

    expect(await screen.findByText('Change walkthrough')).toBeInTheDocument()
    await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_fusion'))
  })
})
