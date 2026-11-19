import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MultiRunSheet } from './MultiRunSheet'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { installPointerCapture } from '@/test/browserFakes'
import {
  makeCatalogModel,
  makeCatalogProvider,
} from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import {
  FuseMultiRunRequestSchema,
  type FuseMultiRunRequest,
  type MultiRun,
  type MultiRunEntry,
  type MultiRunFusion,
} from '@opencode-manager/shared/schemas'
import type { GitBranch } from '@/api/repos'
import type { ChangeWalkthroughState } from '@opencode-manager/shared/schemas'

const catalogProviders = [
  makeCatalogProvider({ id: 'openai', name: 'OpenAI' }),
  makeCatalogProvider({ id: 'anthropic', name: 'Anthropic' }),
]

function model(id: string, name: string, providerID: string, released: number) {
  return makeCatalogModel({ id, modelID: id, name, providerID, time: { released } })
}

const catalogModels = [
  model('gpt-4o', 'GPT-4o', 'openai', 100),
  model('gpt-4o-mini', 'GPT-4o mini', 'openai', 90),
  model('gpt-4.1', 'GPT-4.1', 'openai', 80),
  model('claude-opus', 'Claude Opus', 'anthropic', 70),
  model('claude-sonnet', 'Claude Sonnet', 'anthropic', 60),
  model('claude-haiku', 'Claude Haiku', 'anthropic', 50),
  model('claude-sonnet-4.5', 'Claude Sonnet 4.5', 'anthropic', 40),
]

const branches: GitBranch[] = [
  { name: 'main', type: 'local', current: true },
  { name: 'remotes/origin/HEAD', type: 'remote', current: false },
  { name: 'remotes/origin/release', type: 'remote', current: false },
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
  serverId: 'local',
  directory: null,
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

const emptyWalkthrough: ChangeWalkthroughState = {
  walkthrough: null,
  currentDiffHash: null,
  hasChanges: false,
  stale: false,
  generating: false,
  running: false,
  error: null,
}

interface MultiRunServerOptions {
  runs?: MultiRun[]
  configModel?: string
  launch?: () => FetchRouteResult
  fuse?: (request: FuseMultiRunRequest) => FetchRouteResult
  discard?: () => FetchRouteResult
}

interface MultiRunServer {
  routes: FetchRoute[]
  setRuns: (runs: MultiRun[]) => void
}

function createMultiRunServer(options: MultiRunServerOptions = {}): MultiRunServer {
  let runs = options.runs ?? []
  const configEntries = options.configModel
    ? [{ type: 'document', info: { model: options.configModel } }]
    : []
  return {
    routes: [
      { method: 'GET', path: '/api/multi-runs', respond: () => ({ json: { runs } }) },
      {
        method: 'POST',
        path: '/api/multi-runs',
        respond: () => options.launch?.() ?? { json: { run: oneStartedRun } },
      },
      {
        method: 'POST',
        path: '/api/multi-runs/:runId/fusions',
        respond: (request) => {
          const parsed = FuseMultiRunRequestSchema.safeParse(request.body)
          if (!parsed.success) return { status: 400, json: { error: 'invalid fuse request' } }
          return options.fuse?.(parsed.data) ?? { json: { run: fuseRun } }
        },
      },
      {
        method: 'POST',
        path: '/api/multi-runs/:runId/entries/:entryId/discard',
        respond: () => options.discard?.() ?? { json: { run: oneStartedRun } },
      },
      { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { location: { directory: '/repo' }, data: catalogProviders } }) },
      { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { location: { directory: '/repo' }, data: catalogModels } }) },
      { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
      { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: configEntries }) },
      { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { location: { directory: '/repo' }, data: null } }) },
      { method: 'GET', path: '/api/repos/7/git/branches', respond: () => ({ json: { branches, status: { ahead: 0, behind: 0 } } }) },
      { method: 'GET', path: '/api/change-walkthroughs/helper-sessions', respond: () => ({ json: { sessionIds: [] } }) },
      { method: 'GET', path: '/api/change-walkthroughs/ses_11', respond: () => ({ json: emptyWalkthrough }) },
      { method: 'GET', path: '/api/files', respond: () => ({ json: [] }) },
    ],
    setRuns: (next) => {
      runs = next
    },
  }
}

function renderSheet(options: MultiRunServerOptions & {
  target?: 'repo' | 'server'
  directory?: string
  defaultBaseRef?: string
} = {}) {
  installPointerCapture()
  const server = createMultiRunServer(options)
  const onOpenChangeCalls: boolean[] = []
  const onOpenChange = (open: boolean) => {
    onOpenChangeCalls.push(open)
  }
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const target = options.target === 'server'
    ? { kind: 'server' as const, serverId: 'srv_kitchen', directory: '/srv/app' }
    : { kind: 'repo' as const, repoId: 7 }
  const view = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <MultiRunSheet
        target={target}
        directory={options.directory ?? (options.target === 'server' ? '/srv/app' : '/repo')}
        defaultBaseRef={options.defaultBaseRef ?? (options.target === 'server' ? undefined : 'main')}
        open
        onOpenChange={onOpenChange}
      />
    </>,
    { auth: false, theme: false, route: options.target === 'server' ? '/servers/srv_kitchen' : '/repos/7', fetchRoutes: server.routes },
  )
  return { ...view, server, onOpenChangeCalls, capturedPathname, capturedSearch }
}

function checkboxLabels(): Array<string | null> {
  return screen.getAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label'))
}

async function openNewRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'New run' }))
}

async function fillLaunchForm(user: ReturnType<typeof userEvent.setup>) {
  await openNewRun(user)
  await user.type(screen.getByLabelText('Group name'), 'Sweep')
  await user.type(screen.getByLabelText('Prompt'), 'go')
  await user.click(await screen.findByRole('checkbox', { name: 'GPT-4o' }))
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
      renderSheet({ configModel: 'anthropic/claude-sonnet' })
      await openNewRun(user)

      expect(screen.getByText('Default')).toBeInTheDocument()
      expect(checkboxLabels()).toEqual([
        'Claude Sonnet',
        'Claude Opus',
        'Claude Haiku',
        'Claude Sonnet 4.5',
        'GPT-4o',
        'GPT-4o mini',
        'GPT-4.1',
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

    it('names the missing required fields while Launch is disabled', async () => {
      const user = userEvent.setup()
      renderSheet()
      await openNewRun(user)

      expect(screen.getByRole('button', { name: 'Launch' })).toBeDisabled()
      expect(screen.getByText('Required: group name, prompt, at least one model')).toBeInTheDocument()

      await user.type(screen.getByLabelText('Group name'), 'Sweep')

      expect(screen.getByText('Required: prompt, at least one model')).toBeInTheDocument()

      await user.type(screen.getByLabelText('Prompt'), 'go')
      await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))

      expect(screen.queryByText(/^Required:/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Launch' })).toBeEnabled()
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
      const { fetchFake } = renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toEqual({
          repoId: 7,
          name: 'Sweep',
          prompt: 'go',
          models: ['openai/gpt-4o'],
          isolate: true,
          baseRef: 'main',
        }),
      )
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true'))
    })

    it('submits the selected remote branch as the base ref', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet()

      await fillLaunchForm(user)
      const branchSelect = screen.getByRole('combobox', { name: 'Start from' })
      await waitFor(() => expect(branchSelect).toBeEnabled())
      await user.click(branchSelect)
      await user.click(screen.getByRole('option', { name: /release/ }))
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toMatchObject({ baseRef: 'origin/release' }),
      )
    })

    it('omits the base ref when runs are not isolated', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet()

      await fillLaunchForm(user)
      await user.click(screen.getByRole('switch', { name: 'Isolate runs' }))
      expect(screen.queryByRole('combobox', { name: 'Start from' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toEqual({
          repoId: 7,
          name: 'Sweep',
          prompt: 'go',
          models: ['openai/gpt-4o'],
          isolate: false,
        }),
      )
    })

    it('submits the catalog id for configured model aliases', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet()

      await openNewRun(user)
      await user.type(screen.getByLabelText('Group name'), 'Sweep')
      await user.type(screen.getByLabelText('Prompt'), 'go')
      await user.click(screen.getByRole('checkbox', { name: 'Claude Sonnet 4.5' }))
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toMatchObject({
          models: ['anthropic/claude-sonnet-4.5'],
        }),
      )
    })

    it('renders a single disabled launch button while the launch is pending', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({
        launch: () => new Promise<FetchRouteResult>(() => undefined),
      })

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      const pending = await screen.findByRole('button', { name: 'Launching…' })
      expect(pending).toBeDisabled()
      expect(pending).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByRole('button', { name: 'Launch' })).not.toBeInTheDocument()
      await user.click(pending)
      expect(fetchFake.findRequests('POST', '/api/multi-runs')).toHaveLength(1)
    })

    it('keeps the New run tab when the launch request fails', async () => {
      const user = userEvent.setup()
      renderSheet({ launch: () => ({ status: 500, json: { error: 'launch failed' } }) })

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      expect(await screen.findByText('launch failed')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'New run' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByLabelText('Group name')).toHaveValue('Sweep')
    })
  })

  describe('Runs', () => {
    it('expands the newest run and collapses older ones', async () => {
      const user = userEvent.setup()
      renderSheet({ runs: [oneStartedRun, olderRun] })

      const newest = await screen.findByRole('region', { name: 'Sweep' })
      const older = screen.getByRole('region', { name: 'Older sweep' })
      expect(within(newest).getByText('go')).toBeInTheDocument()
      expect(within(older).queryByText('older prompt')).not.toBeInTheDocument()
      expect(within(older).getByText(/^2 models · isolated · base main/)).toBeInTheDocument()

      await user.click(within(older).getByRole('button', { name: /older sweep/i }))
      expect(within(older).getByText('older prompt')).toBeInTheDocument()
    })

    it('lists entries with their status and failure reason', async () => {
      renderSheet({ runs: [oneStartedRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('openai/gpt-4o')).toBeInTheDocument()
      expect(within(card).getByText('Ready')).toBeInTheDocument()
      expect(within(card).getByText('Failed')).toBeInTheDocument()
      expect(within(card).getByText('launch failed')).toBeInTheDocument()
    })

    it('labels a launched entry with a busy session as running', async () => {
      useSessionStatus.getState().setStatus('ses_11', { type: 'busy' })
      renderSheet({ runs: [oneStartedRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('Running')).toBeInTheDocument()
      expect(within(card).queryByText('Ready')).not.toBeInTheDocument()
    })

    it('opens a started entry in the workspaces tab and closes the sheet', async () => {
      const user = userEvent.setup()
      const result = renderSheet({ runs: [oneStartedRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      await user.click(within(card).getByRole('button', { name: 'Open' }))

      expect(result.onOpenChangeCalls).toContain(false)
      expect(result.capturedPathname.current).toBe('/repos/7/sessions/ses_11')
      expect(result.capturedSearch.current).toBe('?repoTab=workspaces')
    })

    it('discards an entry from its overflow menu after confirmation', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({ runs: [oneStartedRun] })

      await user.click(await screen.findByRole('button', { name: 'More actions for openai/gpt-4o' }))
      await user.click(await screen.findByRole('menuitem', { name: /discard/i }))

      const confirmDialog = await screen.findByRole('dialog', { name: 'Discard run' })
      await user.click(within(confirmDialog).getByRole('button', { name: 'Discard' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs/3/entries/11/discard')).toBeDefined(),
      )
    })

    it('opens the walkthrough dialog for an entry session', async () => {
      const user = userEvent.setup()
      const result = renderSheet({ runs: [oneStartedRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      await user.click(within(card).getByRole('button', { name: /walkthrough/i }))

      expect(await screen.findByText('Change walkthrough')).toBeInTheDocument()
      await waitFor(() =>
        expect(result.fetchFake.findRequests('GET', '/api/change-walkthroughs/ses_11')).toHaveLength(1),
      )
    })

    it('lists fusions with truncation and opens the fusion session', async () => {
      const user = userEvent.setup()
      const result = renderSheet({ runs: [{ ...oneStartedRun, fusions: [fusion()] }] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByText('Fusions')).toBeInTheDocument()
      expect(within(card).getByText('from 1 source (truncated)')).toBeInTheDocument()

      const fusionRow = within(card).getByText('from 1 source (truncated)').closest<HTMLElement>('li')
      expect(fusionRow).not.toBeNull()
      await user.click(within(fusionRow ?? card).getByRole('button', { name: 'Open' }))
      expect(result.capturedPathname.current).toBe('/repos/7/sessions/ses_fusion')
      expect(result.capturedSearch.current).toBe('?repoTab=workspaces')
    })
  })

  describe('Fusion selection mode', () => {
    it('disables Fuse results for runs with fewer than two launched entries', async () => {
      renderSheet({ runs: [oneStartedRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).getByRole('button', { name: /fuse results/i })).toBeDisabled()
    })

    it('enters selection mode in place and exits it', async () => {
      const user = userEvent.setup()
      renderSheet({ runs: [fuseRun] })

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
      renderSheet({ runs: [fuseRun] })

      const card = await enterSelection(user)

      expect(within(card).getByRole('checkbox', { name: 'openai/gpt-4.1' })).toBeDisabled()
      expect(within(card).getByText('Unavailable · still running — wait for a final reply')).toBeInTheDocument()
      expect(within(card).getByRole('checkbox', { name: 'anthropic/claude-haiku' })).toBeDisabled()
      expect(within(card).getByText('Unavailable · provider overloaded')).toBeInTheDocument()
      expect(within(card).getByRole('checkbox', { name: 'openai/gpt-4o' })).toBeEnabled()
    })

    it('requires two sources and a synthesis model before starting', async () => {
      const user = userEvent.setup()
      renderSheet({ runs: [fuseRun] })

      const card = await enterSelection(user)
      const submit = screen.getByRole('button', { name: /start fusion/i })

      await user.click(within(card).getByRole('checkbox', { name: 'openai/gpt-4o' }))
      await user.click(within(card).getByRole('checkbox', { name: 'anthropic/claude-opus' }))
      expect(submit).toBeDisabled()
      expect(screen.getByText('2 of 4 selected')).toBeInTheDocument()

      await chooseSynthesisModel(user, 'openai/gpt-4o')
      expect(submit).toBeEnabled()
    })

    it('submits the selected sources, model, instructions and base ref', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({
        runs: [fuseRun],
        fuse: (request) => ({ json: { run: startedFusionResponse(request) } }),
      })

      await selectSourcesAndModel(user)
      await user.click(screen.getByText('Instructions (optional)'))
      await user.type(screen.getByLabelText('Instructions'), 'Merge the best ideas')
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      await waitFor(() => expect(fetchFake.findRequests('POST', '/api/multi-runs/5/fusions')).toHaveLength(1))
      expect(fetchFake.lastRequest('POST', '/api/multi-runs/5/fusions')?.body).toEqual({
        requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        entryIds: [11, 13],
        model: 'openai/gpt-4o',
        instructions: 'Merge the best ideas',
        baseRef: 'main',
      })
    })

    it('always runs the fusion in a new worktree without a destination choice', async () => {
      const user = userEvent.setup()
      renderSheet({
        runs: [{ ...fuseRun, entries: fuseRun.entries.map((item) => (item.id === 11 ? { ...item, isolated: false } : item)) }],
      })

      await selectSourcesAndModel(user)

      expect(screen.queryByRole('radio', { name: 'Repository checkout' })).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Base ref' })).toBeInTheDocument()
    })

    it('shows the new fusion as Starting while the request is pending', async () => {
      const user = userEvent.setup()
      renderSheet({ runs: [fuseRun], fuse: () => new Promise<FetchRouteResult>(() => undefined) })

      const card = await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await within(card).findByText('Fusions')).toBeInTheDocument()
      expect(within(card).getByText('Starting')).toBeInTheDocument()
      expect(within(card).getByText('from 2 sources')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /start fusion/i }))
      expect(screen.getAllByRole('button', { name: /start fusion/i })).toHaveLength(1)
    })

    it('opens the new session when the fusion starts', async () => {
      const user = userEvent.setup()
      const result = renderSheet({
        runs: [fuseRun],
        fuse: (request) => ({ json: { run: startedFusionResponse(request) } }),
      })

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      await waitFor(() => expect(result.capturedPathname.current).toBe('/repos/7/sessions/ses_new_fusion'))
      expect(result.capturedSearch.current).toBe('?repoTab=workspaces')
      expect(result.onOpenChangeCalls).toContain(false)
    })

    it('regenerates the request id after a failed fusion', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({
        runs: [fuseRun],
        fuse: (request) => ({ json: { run: startedFusionResponse(request, 'failed') } }),
      })

      await selectSourcesAndModel(user)
      const submit = screen.getByRole('button', { name: /start fusion/i })
      await user.click(submit)
      await waitFor(() => expect(fetchFake.findRequests('POST', '/api/multi-runs/5/fusions')).toHaveLength(1))
      await waitFor(() => expect(submit).toBeEnabled())
      await user.click(submit)
      await waitFor(() => expect(fetchFake.findRequests('POST', '/api/multi-runs/5/fusions')).toHaveLength(2))

      const [first, second] = fetchFake.findRequests('POST', '/api/multi-runs/5/fusions')
      const firstBody = FuseMultiRunRequestSchema.parse(first?.body)
      const secondBody = FuseMultiRunRequestSchema.parse(second?.body)
      expect(secondBody.requestId).not.toBe(firstBody.requestId)
    })

    it('shows unavailable source reasons inline on the affected rows', async () => {
      const user = userEvent.setup()
      renderSheet({
        runs: [fuseRun],
        fuse: () => ({
          status: 409,
          json: {
            error: 'Some selected results are not ready to fuse',
            code: 'FUSION_SOURCES_UNAVAILABLE',
            details: {
              unavailableSources: [
                { entryId: 13, model: 'anthropic/claude-opus', reason: 'running', message: 'The session is still running.' },
              ],
            },
          },
        }),
      })

      const card = await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await within(card).findByText('Unavailable · The session is still running.')).toBeInTheDocument()
      expect(screen.getByText('Some selected results are not ready to fuse. See the marked rows.')).toBeInTheDocument()
    })

    it('shows the context limit message in the composer', async () => {
      const user = userEvent.setup()
      renderSheet({
        runs: [fuseRun],
        fuse: () => ({ status: 413, json: { error: 'The selected results are too large to fuse.', code: 'FUSION_CONTEXT_LIMIT' } }),
      })

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await screen.findByText('Too much context: select fewer sources or shorten instructions')).toBeInTheDocument()
    })

    it('offers to open a recovered fusion attempt', async () => {
      const user = userEvent.setup()
      const result = renderSheet({
        runs: [fuseRun],
        fuse: () => ({
          status: 409,
          json: {
            error: 'An earlier fusion attempt is already running',
            code: 'FUSION_ATTEMPT_RECOVERED',
            details: { fusions: [{ fusionId: 31, sessionId: 'ses_recovered' }] },
          },
        }),
      })

      await selectSourcesAndModel(user)
      await user.click(screen.getByRole('button', { name: /start fusion/i }))

      expect(await screen.findByText('An earlier attempt is already running.')).toBeInTheDocument()
      const message = screen.getByText('An earlier attempt is already running.').parentElement
      expect(message).not.toBeNull()
      await user.click(within(message ?? document.body).getByRole('button', { name: 'Open' }))
      expect(result.capturedPathname.current).toBe('/repos/7/sessions/ses_recovered')
    })
  })

  describe('Linked server target', () => {
    const serverRun: MultiRun = {
      ...oneStartedRun,
      repoId: null,
      serverId: 'srv_kitchen',
      directory: '/srv/app',
    }

    it('lists the runs of the server directory', async () => {
      const result = renderSheet({ target: 'server', runs: [serverRun] })

      expect(await screen.findByRole('region', { name: 'Sweep' })).toBeInTheDocument()
      const request = result.fetchFake.lastRequest('GET', '/api/multi-runs')
      expect(request?.searchParams.get('serverId')).toBe('srv_kitchen')
      expect(request?.searchParams.get('directory')).toBe('/srv/app')
    })

    it('launches with the server target instead of a repository', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({ target: 'server' })

      await fillLaunchForm(user)
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toEqual({
          serverId: 'srv_kitchen',
          directory: '/srv/app',
          name: 'Sweep',
          prompt: 'go',
          models: ['openai/gpt-4o'],
          isolate: true,
        }),
      )
    })

    it('takes the base ref as text because server branches are not listed', async () => {
      const user = userEvent.setup()
      const { fetchFake } = renderSheet({ target: 'server' })

      await openNewRun(user)
      expect(screen.getByRole('textbox', { name: 'Start from' })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Start from' })).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('Start from'), 'release')
      expect(fetchFake.findRequests('GET', '/api/repos/7/git/branches')).toHaveLength(0)

      await user.type(screen.getByLabelText('Group name'), 'Sweep')
      await user.type(screen.getByLabelText('Prompt'), 'go')
      await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
      await user.click(screen.getByRole('button', { name: 'Launch' }))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/multi-runs')?.body).toMatchObject({ baseRef: 'release' }),
      )
    })

    it('opens sessions on the server route and hides the local-only walkthrough', async () => {
      const user = userEvent.setup()
      const result = renderSheet({ target: 'server', runs: [serverRun] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      expect(within(card).queryByRole('button', { name: /walkthrough/i })).not.toBeInTheDocument()

      await user.click(within(card).getByRole('button', { name: 'Open' }))

      expect(result.onOpenChangeCalls).toContain(false)
      expect(result.capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_11')
    })

    it('opens a server fusion session on the server route', async () => {
      const user = userEvent.setup()
      const result = renderSheet({ target: 'server', runs: [{ ...serverRun, fusions: [fusion()] }] })

      const card = await screen.findByRole('region', { name: 'Sweep' })
      const fusionRow = within(card).getByText('from 1 source (truncated)').closest<HTMLElement>('li')
      expect(fusionRow).not.toBeNull()
      await user.click(within(fusionRow ?? card).getByRole('button', { name: 'Open' }))

      expect(result.capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_fusion')
    })
  })
})
