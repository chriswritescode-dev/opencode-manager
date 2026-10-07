import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MultiRunSheet } from './MultiRunSheet'
import { FetchError } from '@/api/fetchWrapper'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import type { FuseMultiRunRequest, MultiRun, MultiRunEntry, MultiRunFusion } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  listMultiRuns: vi.fn(),
  launchMultiRun: vi.fn(),
  discardMultiRunEntry: vi.fn(),
  fuseMultiRun: vi.fn(),
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
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

vi.mock('@/hooks/useProviders', () => ({
  useProviders: mocks.useProviders,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
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
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', released: 0, free: false },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', released: 0, free: false },
      { id: 'gpt-4.1', name: 'GPT-4.1', released: 0, free: false },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-opus', name: 'Claude Opus', released: 0, free: false },
      { id: 'claude-sonnet', name: 'Claude Sonnet', released: 0, free: false },
      { id: 'claude-haiku', name: 'Claude Haiku', released: 0, free: false },
      { id: 'claude-sonnet-4-5', key: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', released: 0, free: false },
    ],
  },
]

function entry(overrides: Partial<MultiRunEntry> & Pick<MultiRunEntry, 'id' | 'model'>): MultiRunEntry {
  return {
    status: 'started',
    sessionId: `ses_${overrides.id}`,
    directory: `/workspaces/sweep-${overrides.id}`,
    isolated: true,
    error: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function fusion(overrides: Partial<MultiRunFusion> = {}): MultiRunFusion {
  return {
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
    sources: [{ entryId: 11, sessionId: 'ses_11', model: 'openai/gpt-4o', truncated: true }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const oneStartedRun: MultiRun = {
  id: 3,
  repoId: 7,
  name: 'Sweep',
  prompt: 'go',
  isolated: true,
  baseRef: 'main',
  createdAt: 1,
  entries: [
    entry({ id: 11, model: 'openai/gpt-4o' }),
    entry({ id: 12, model: 'anthropic/claude-opus', status: 'failed', sessionId: null, directory: null, error: 'launch failed' }),
  ],
  fusions: [],
}

const fuseRun: MultiRun = {
  ...oneStartedRun,
  id: 5,
  name: 'Pair',
  prompt: 'compare approaches',
  entries: [
    entry({ id: 11, model: 'openai/gpt-4o' }),
    entry({ id: 13, model: 'anthropic/claude-opus' }),
    entry({ id: 14, model: 'openai/gpt-4.1' }),
    entry({ id: 15, model: 'anthropic/claude-haiku', status: 'failed', sessionId: null, directory: null, error: 'provider overloaded' }),
  ],
}

const olderRun: MultiRun = {
  ...oneStartedRun,
  id: 2,
  name: 'Older sweep',
  prompt: 'older prompt',
  entries: [entry({ id: 21, model: 'openai/gpt-4.1' }), entry({ id: 22, model: 'openai/gpt-4o-mini' })],
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof MultiRunSheet>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(
    <MultiRunSheet repoId={7} directory="/repo" defaultBaseRef="main" open onOpenChange={onOpenChange} {...overrides} />,
    { wrapper: createWrapper() },
  )
  return { ...view, onOpenChange }
}

function checkboxLabels() {
  return screen.getAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label'))
}

async function openNewRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'New run' }))
}

async function fillLaunchForm(user: ReturnType<typeof userEvent.setup>) {
  await openNewRun(user)
  await user.type(screen.getByLabelText('Group name'), 'Sweep')
  await user.type(screen.getByLabelText('Prompt'), 'go')
  await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
}

async function enterSelection(user: ReturnType<typeof userEvent.setup>, runName = 'Pair') {
  const card = await screen.findByRole('region', { name: runName })
  await user.click(within(card).getByRole('button', { name: /fuse results/i }))
  return card
}

async function chooseSynthesisModel(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(screen.getByRole('combobox', { name: 'Synthesis model' }))
  await user.click(screen.getByRole('option', { name: new RegExp(`${value.replace('.', '\\.')}$`) }))
}

async function selectSourcesAndModel(user: ReturnType<typeof userEvent.setup>) {
  const card = await enterSelection(user)
  await user.click(within(card).getByRole('checkbox', { name: 'openai/gpt-4o' }))
  await user.click(within(card).getByRole('checkbox', { name: 'anthropic/claude-opus' }))
  await chooseSynthesisModel(user, 'openai/gpt-4o')
  return card
}

function startedFusionResponse(request: FuseMultiRunRequest, status: MultiRunFusion['status'] = 'started'): MultiRun {
  return {
    ...fuseRun,
    fusions: [
      fusion({
        id: 1,
        requestId: request.requestId,
        model: request.model,
        status,
        sessionId: status === 'started' ? 'ses_new_fusion' : null,
        error: status === 'failed' ? 'launch failed' : null,
        sources: [],
      }),
    ],
  }
}

describe('MultiRunSheet', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    for (const sessionId of useSessionStatus.getState().statuses.keys()) {
      useSessionStatus.getState().clearStatus(sessionId)
    }
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] }, isLoading: false })
    mocks.useOpenCodeModelState.mockReturnValue({ data: { recent: [], favorite: [], variant: {} } })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: null })
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

  it('opens as a right sheet on the Runs tab', async () => {
    renderSheet()

    expect(screen.getByRole('dialog', { name: 'Multi-run' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
  })

  it('switches to the New run tab from the empty state', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Start a new run' }))

    expect(screen.getByRole('tab', { name: 'New run' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Group name')).toBeInTheDocument()
  })

  describe('New run', () => {
    it('lists the OpenCode default model first without repeating it', async () => {
      const user = userEvent.setup()
      mocks.useOpenCodeDefaultModel.mockReturnValue({ data: 'anthropic/claude-sonnet' })
      renderSheet()
      await openNewRun(user)

      expect(screen.getByText('Default')).toBeInTheDocument()
      expect(checkboxLabels()).toEqual([
        'Claude Sonnet',
        'GPT-4o',
        'GPT-4o mini',
        'GPT-4.1',
        'Claude Opus',
        'Claude Haiku',
        'Claude Sonnet 4.5',
      ])
    })

    it('filters models by every search term', async () => {
      const user = userEvent.setup()
      renderSheet()
      await openNewRun(user)

      await user.type(screen.getByLabelText('Search models'), 'anthropic haiku')
      await waitFor(() => expect(checkboxLabels()).toEqual(['Claude Haiku']))

      await user.type(screen.getByLabelText('Search models'), 'zzz')
      expect(await screen.findByText('No models match your search.')).toBeInTheDocument()
    })

    it('keeps the form when switching tabs', async () => {
      const user = userEvent.setup()
      renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('tab', { name: 'Runs' }))
      await openNewRun(user)

      expect(screen.getByLabelText('Group name')).toHaveValue('Sweep')
      expect(screen.getByText('1/5 selected')).toBeInTheDocument()
    })

    it('caps model selection at five', async () => {
      const user = userEvent.setup()
      renderSheet()
      await openNewRun(user)

      for (const name of ['GPT-4o', 'GPT-4o mini', 'GPT-4.1', 'Claude Opus', 'Claude Sonnet']) {
        await user.click(screen.getByRole('checkbox', { name }))
      }

      expect(screen.getByText('5/5 selected')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Claude Haiku' })).toBeDisabled()
    })

    it('submits the launch request and switches to Runs', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockResolvedValue(oneStartedRun)
      renderSheet()

      await fillLaunchForm(user)
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
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true'))
    })

    it('submits the selected remote branch as the base ref', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockResolvedValue(oneStartedRun)
      renderSheet()

      await fillLaunchForm(user)
      const branchSelect = screen.getByRole('combobox', { name: 'Start from' })
      await waitFor(() => expect(branchSelect).toBeEnabled())
      await user.click(branchSelect)
      await user.click(screen.getByRole('option', { name: /release/ }))
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() => {
        expect(mocks.launchMultiRun).toHaveBeenCalledWith(expect.objectContaining({ baseRef: 'origin/release' }))
      })
    })

    it('omits the base ref when runs are not isolated', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockResolvedValue(oneStartedRun)
      renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('switch', { name: 'Isolate runs' }))
      expect(screen.queryByRole('combobox', { name: 'Start from' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() => expect(mocks.launchMultiRun).toHaveBeenCalledTimes(1))
      expect(mocks.launchMultiRun.mock.calls[0][0]).toEqual({
        repoId: 7,
        name: 'Sweep',
        prompt: 'go',
        models: ['openai/gpt-4o'],
        isolate: false,
      })
    })

    it('submits the catalog id for configured model aliases', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockResolvedValue(oneStartedRun)
      renderSheet()

      await openNewRun(user)
      await user.type(screen.getByLabelText('Group name'), 'Sweep')
      await user.type(screen.getByLabelText('Prompt'), 'go')
      await user.click(screen.getByRole('checkbox', { name: 'Claude Sonnet 4.5' }))
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() => {
        expect(mocks.launchMultiRun).toHaveBeenCalledWith(
          expect.objectContaining({ models: ['anthropic/claude-sonnet-4.5'] }),
        )
      })
    })

    it('renders a single disabled launch button while the launch is pending', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockReturnValue(new Promise(() => {}))
      renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      const pending = await screen.findByRole('button', { name: 'Launching…' })
      expect(pending).toBeDisabled()
      expect(pending).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByRole('button', { name: 'Launch' })).not.toBeInTheDocument()
      await user.click(pending)
      expect(mocks.launchMultiRun).toHaveBeenCalledTimes(1)
    })

    it('keeps the New run tab when the launch request fails', async () => {
      const user = userEvent.setup()
      mocks.launchMultiRun.mockRejectedValue(new Error('launch failed'))
      renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() => expect(mocks.launchMultiRun).toHaveBeenCalled())
      expect(screen.getByRole('tab', { name: 'New run' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByLabelText('Group name')).toHaveValue('Sweep')
    })
  })

  describe('Runs', () => {
    it('expands the newest run and collapses older ones', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun, olderRun])
      renderSheet()

      const newest = await screen.findByRole('region', { name: 'Sweep' })
      const older = screen.getByRole('region', { name: 'Older sweep' })
      expect(within(newest).getByText('go')).toBeInTheDocument()
      expect(within(older).queryByText('older prompt')).not.toBeInTheDocument()
      expect(within(older).getByText(/^2 models · isolated · base main/)).toBeInTheDocument()

      await user.click(within(older).getByRole('button', { name: /older sweep/i }))
      expect(within(older).getByText('older prompt')).toBeInTheDocument()
    })

    it('lists entries with their status and failure reason', async () => {
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('openai/gpt-4o')).toBeInTheDocument()
      expect(within(card).getByText('Ready')).toBeInTheDocument()
      expect(within(card).getByText('Failed')).toBeInTheDocument()
      expect(within(card).getByText('launch failed')).toBeInTheDocument()
    })

    it('labels a launched entry with a busy session as running', async () => {
      useSessionStatus.getState().setStatus('ses_11', { type: 'busy' })
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('Running')).toBeInTheDocument()
      expect(within(card).queryByText('Ready')).not.toBeInTheDocument()
    })

    it('opens a started entry in the workspaces tab and closes the sheet', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      const { onOpenChange } = renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      await user.click(within(card).getByRole('button', { name: 'Open' }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_11?repoTab=workspaces')
    })

    it('discards an entry from its overflow menu after confirmation', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      mocks.discardMultiRunEntry.mockResolvedValue(oneStartedRun)
      renderSheet()

      await user.click(await screen.findByRole('button', { name: 'More actions for openai/gpt-4o' }))
      await user.click(await screen.findByRole('menuitem', { name: /discard/i }))

      const confirmDialog = await screen.findByRole('dialog', { name: 'Discard run' })
      await user.click(within(confirmDialog).getByRole('button', { name: 'Discard' }))

      await waitFor(() => expect(mocks.discardMultiRunEntry).toHaveBeenCalledWith(3, 11))
    })

    it('opens the walkthrough dialog for an entry session', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      await user.click(within(card).getByRole('button', { name: /walkthrough/i }))

      expect(await screen.findByText('Change walkthrough')).toBeInTheDocument()
      await waitFor(() => expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_11'))
    })

    it('lists fusions with truncation and opens the fusion session', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([{ ...oneStartedRun, fusions: [fusion()] }])
      renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('Fusions')).toBeInTheDocument()
      expect(within(card).getByText('from 1 source (truncated)')).toBeInTheDocument()

      const fusionRow = within(card).getByText('from 1 source (truncated)').closest('li') as HTMLElement
      await user.click(within(fusionRow).getByRole('button', { name: 'Open' }))
      expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_fusion?repoTab=workspaces')
    })
  })

  describe('Fusion selection mode', () => {
    beforeEach(() => {
      mocks.listMultiRuns.mockResolvedValue([fuseRun])
    })

    it('disables Fuse results for runs with fewer than two launched entries', async () => {
      mocks.listMultiRuns.mockResolvedValue([oneStartedRun])
      renderSheet()

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByRole('button', { name: /fuse results/i })).toBeDisabled()
    })

    it('enters selection mode in place and exits it', async () => {
      const user = userEvent.setup()
      renderSheet()

      const card = await enterSelection(user)
      expect(within(card).getByText('Selection mode')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /start fusion/i })).toBeDisabled()

      await user.click(within(card).getByRole('button', { name: 'Exit' }))
      expect(within(card).queryByText('Selection mode')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /start fusion/i })).not.toBeInTheDocument()
      expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('dims unready entries with their reason and blocks selecting them', async () => {
      const user = userEvent.setup()
      useSessionStatus.getState().setStatus('ses_14', { type: 'busy' })
      renderSheet()

      const card = await enterSelection(user)

      expect(within(card).getByRole('checkbox', { name: 'openai/gpt-4.1' })).toBeDisabled()
      expect(within(card).getByText('Unavailable · still running — wait for a final reply')).toBeInTheDocument()
      expect(within(card).getByRole('checkbox', { name: 'anthropic/claude-haiku' })).toBeDisabled()
      expect(within(card).getByText('Unavailable · provider overloaded')).toBeInTheDocument()
      expect(within(card).getByRole('checkbox', { name: 'openai/gpt-4o' })).toBeEnabled()
    })

    it('requires two sources and a synthesis model before starting', async () => {
      const user = userEvent.setup()
      renderSheet()

      const card = await enterSelection(user)
      const submit = screen.getByRole('button', { name: /start fusion/i })

      await user.click(within(card).getByRole('checkbox', { name: 'openai/gpt-4o' }))
      await user.click(within(card).getByRole('checkbox', { name: 'anthropic/claude-opus' }))
      expect(submit).toBeDisabled()
      expect(screen.getByText('2 of 4 selected')).toBeInTheDocument()

      await chooseSynthesisModel(user, 'openai/gpt-4o')
      expect(submit).toBeEnabled()
    })

    it('submits the selected sources, model, instructions and isolated destination', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockResolvedValue(fuseRun)
      renderSheet()

      await selectSourcesAndModel(user)
      await user.click(screen.getByText('Instructions (optional)'))
      await user.type(screen.getByLabelText('Instructions'), 'Merge the best ideas')
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))
      const [runId, request] = mocks.fuseMultiRun.mock.calls[0] as [number, FuseMultiRunRequest]
      expect(runId).toBe(5)
      expect(request).toEqual({
        requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        entryIds: [11, 13],
        model: 'openai/gpt-4o',
        instructions: 'Merge the best ideas',
        isolate: true,
        baseRef: 'main',
      })
    })

    it('runs in the repository checkout without a base ref when chosen', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockResolvedValue(fuseRun)
      renderSheet()

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('radio', { name: 'Repository checkout' }))
      expect(screen.queryByRole('combobox', { name: 'Base ref' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))
      const [, request] = mocks.fuseMultiRun.mock.calls[0] as [number, FuseMultiRunRequest]
      expect(request).toMatchObject({ isolate: false })
      expect(request).not.toHaveProperty('baseRef')
    })

    it('forces isolation when a selected source ran in the repository checkout', async () => {
      const user = userEvent.setup()
      mocks.listMultiRuns.mockResolvedValue([
        { ...fuseRun, entries: fuseRun.entries.map((item) => (item.id === 11 ? { ...item, isolated: false } : item)) },
      ])
      renderSheet()

      await selectSourcesAndModel(user)

      expect(screen.getByRole('radio', { name: 'Repository checkout' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Isolated' })).toHaveAttribute('aria-checked', 'true')
      expect(
        screen.getByText('Isolation is required because a selected result ran in the repository checkout.'),
      ).toBeInTheDocument()
    })

    it('shows the new fusion as Starting while the request is pending', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockReturnValue(new Promise(() => {}))
      renderSheet()

      const card = await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await within(card).findByText('Fusions')).toBeInTheDocument()
      expect(within(card).getByText('Starting')).toBeInTheDocument()
      expect(within(card).getByText('from 2 sources')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /start fusion/i }))
      expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1)
    })

    it('opens the new session when the fusion starts', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockImplementation((_runId: number, request: FuseMultiRunRequest) =>
        Promise.resolve(startedFusionResponse(request)),
      )
      const { onOpenChange } = renderSheet()

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_new_fusion?repoTab=workspaces')
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('regenerates the request id after a failed fusion', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockImplementation((_runId: number, request: FuseMultiRunRequest) =>
        Promise.resolve(startedFusionResponse(request, 'failed')),
      )
      renderSheet()

      await selectSourcesAndModel(user)
      const submit = screen.getByRole('button', { name: /start fusion/i })
      await user.click(submit)
      await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(submit).toBeEnabled())
      await user.click(submit)
      await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(2))

      const first = mocks.fuseMultiRun.mock.calls[0][1] as FuseMultiRunRequest
      const second = mocks.fuseMultiRun.mock.calls[1][1] as FuseMultiRunRequest
      expect(second.requestId).not.toBe(first.requestId)
    })

    it('shows unavailable source reasons inline on the affected rows', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockRejectedValue(
        new FetchError('Some selected results are not ready to fuse', 409, 'FUSION_SOURCES_UNAVAILABLE', undefined, {
          details: {
            unavailableSources: [
              { entryId: 13, model: 'anthropic/claude-opus', reason: 'running', message: 'The session is still running.' },
            ],
          },
        }),
      )
      renderSheet()

      const card = await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await within(card).findByText('Unavailable · The session is still running.')).toBeInTheDocument()
      expect(screen.getByText('Some selected results are not ready to fuse. See the marked rows.')).toBeInTheDocument()
    })

    it('shows the context limit message in the composer', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockRejectedValue(
        new FetchError('The selected results are too large to fuse.', 413, 'FUSION_CONTEXT_LIMIT'),
      )
      renderSheet()

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await screen.findByText('Too much context: select fewer sources or shorten instructions')).toBeInTheDocument()
    })

    it('offers to open a recovered fusion attempt', async () => {
      const user = userEvent.setup()
      mocks.fuseMultiRun.mockRejectedValue(
        new FetchError('An earlier fusion attempt is already running', 409, 'FUSION_ATTEMPT_RECOVERED', undefined, {
          details: { fusions: [{ fusionId: 31, sessionId: 'ses_recovered' }] },
        }),
      )
      renderSheet()

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await screen.findByText('An earlier attempt is already running.')).toBeInTheDocument()
      const message = screen.getByText('An earlier attempt is already running.').parentElement as HTMLElement
      await user.click(within(message).getByRole('button', { name: 'Open' }))
      expect(mockNavigate).toHaveBeenCalledWith('/repos/7/sessions/ses_recovered')
    })
  })
})
