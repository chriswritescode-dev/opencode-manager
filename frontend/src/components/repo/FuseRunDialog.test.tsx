import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FuseRunDialog } from './FuseRunDialog'
import { FetchError } from '@/api/fetchWrapper'
import type { FuseMultiRunRequest, MultiRun } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  fuseMultiRun: vi.fn(),
  listMultiRuns: vi.fn(),
  launchMultiRun: vi.fn(),
  discardMultiRunEntry: vi.fn(),
  useProvidersWithModels: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  listBranches: vi.fn(),
}))

vi.mock('@/api/multiRuns', () => ({
  fuseMultiRun: mocks.fuseMultiRun,
  listMultiRuns: mocks.listMultiRuns,
  launchMultiRun: mocks.launchMultiRun,
  discardMultiRunEntry: mocks.discardMultiRunEntry,
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
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    source: 'configured',
    isConnected: true,
    models: [{ id: 'claude-opus', name: 'Claude Opus' }],
  },
]

const run: MultiRun = {
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
      status: 'started',
      sessionId: 'ses_2',
      directory: '/workspaces/sweep-2',
      isolated: true,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 13,
      model: 'openai/gpt-4.1',
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

const nonIsolatedRun: MultiRun = {
  ...run,
  entries: run.entries.map((entry) => (entry.id === 11 ? { ...entry, isolated: false } : entry)),
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderFuseDialog(overrides: Partial<React.ComponentProps<typeof FuseRunDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onOpenSession = vi.fn()
  const view = render(
    <FuseRunDialog
      repoId={7}
      directory="/repo"
      run={run}
      open
      onOpenChange={onOpenChange}
      onOpenSession={onOpenSession}
      {...overrides}
    />,
    { wrapper: createWrapper() },
  )
  return { ...view, onOpenChange, onOpenSession }
}

async function selectSourcesAndModel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'openai/gpt-4o' }))
  await user.click(screen.getByRole('checkbox', { name: 'anthropic/claude-opus' }))
  await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
}

describe('FuseRunDialog', () => {
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
        { name: 'feature', type: 'local', current: false },
      ],
      status: { ahead: 0, behind: 0 },
    })
  })

  it('only allows started sources and blocks submit until two sources and a model are selected', async () => {
    const user = userEvent.setup()
    renderFuseDialog()

    const failed = screen.getByRole('checkbox', { name: 'openai/gpt-4.1' })
    expect(failed).toBeDisabled()

    const submit = screen.getByRole('button', { name: 'Fuse' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'openai/gpt-4o' }))
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'anthropic/claude-opus' }))
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
    expect(submit).toBeEnabled()
  })

  it('replaces the synthesis model when a different model is toggled', async () => {
    const user = userEvent.setup()
    renderFuseDialog()

    await user.click(screen.getByRole('checkbox', { name: 'GPT-4o' }))
    expect(screen.getByRole('checkbox', { name: 'GPT-4o' })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'Claude Opus' }))
    expect(screen.getByRole('checkbox', { name: 'GPT-4o' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Claude Opus' })).toBeChecked()
  })

  it('submits the selected sources, model, instructions and workspace', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockResolvedValue({ ...run, fusions: [] })
    renderFuseDialog()

    await selectSourcesAndModel(user)
    await user.type(screen.getByLabelText('Instructions'), 'Merge the best ideas')
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => {
      expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1)
    })
    const [runId, request] = mocks.fuseMultiRun.mock.calls[0] as [number, FuseMultiRunRequest]
    expect(runId).toBe(3)
    expect(request).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      entryIds: [11, 12],
      model: 'openai/gpt-4o',
      instructions: 'Merge the best ideas',
      isolate: true,
      baseRef: 'main',
    })
  })

  it('does not submit again while the request is pending', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockReturnValue(new Promise(() => {}))
    renderFuseDialog()

    await selectSourcesAndModel(user)
    const submit = screen.getByRole('button', { name: 'Fuse' })
    await user.click(submit)
    await user.click(submit)

    expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1)
  })

  it('lists unavailable sources and reasons from a 409 response', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockRejectedValue(
      new FetchError('Some selected results are not ready to fuse', 409, 'FUSION_SOURCES_UNAVAILABLE', undefined, {
        details: {
          unavailableSources: [
            { entryId: 12, model: 'anthropic/claude-opus', reason: 'running', message: 'The session is still running.' },
          ],
        },
      }),
    )
    renderFuseDialog()

    await selectSourcesAndModel(user)
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(await screen.findByText('anthropic/claude-opus: The session is still running.')).toBeInTheDocument()
  })

  it('shows the context limit message for a 413 response', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockRejectedValue(
      new FetchError('The selected results are too large to fuse.', 413, 'FUSION_CONTEXT_LIMIT'),
    )
    renderFuseDialog()

    await selectSourcesAndModel(user)
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(
      await screen.findByText('Too much context: select fewer sources or shorten instructions'),
    ).toBeInTheDocument()
  })

  it('closes and opens the new session when the fusion starts', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockImplementation((_runId: number, request: FuseMultiRunRequest) =>
      Promise.resolve({
        ...run,
        fusions: [
          {
            id: 1,
            requestId: request.requestId,
            model: request.model,
            instructions: null,
            isolated: true,
            baseRef: 'main',
            status: 'started',
            sessionId: 'ses_fusion',
            directory: '/workspaces/fusion',
            error: null,
            sources: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )
    const { onOpenChange, onOpenSession } = renderFuseDialog()

    await selectSourcesAndModel(user)
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => {
      expect(onOpenSession).toHaveBeenCalledWith('ses_fusion', true)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('regenerates the request id after a failed fusion so retries are idempotent per failure', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockImplementation((_runId: number, request: FuseMultiRunRequest) =>
      Promise.resolve({
        ...run,
        fusions: [
          {
            id: 1,
            requestId: request.requestId,
            model: request.model,
            instructions: null,
            isolated: true,
            baseRef: 'main',
            status: 'failed',
            sessionId: null,
            directory: null,
            error: 'launch failed',
            sources: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )
    renderFuseDialog()

    await selectSourcesAndModel(user)
    const submit = screen.getByRole('button', { name: 'Fuse' })
    await user.click(submit)
    await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))

    await user.click(submit)
    await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(2))

    const first = mocks.fuseMultiRun.mock.calls[0][1] as FuseMultiRunRequest
    const second = mocks.fuseMultiRun.mock.calls[1][1] as FuseMultiRunRequest
    expect(second.requestId).not.toBe(first.requestId)
  })

  it('runs in the repository checkout and omits the base ref when isolation is off', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockResolvedValue({ ...run, fusions: [] })
    renderFuseDialog()

    await user.click(screen.getByRole('switch', { name: 'Isolated workspace' }))
    expect(screen.getByText('Runs in the repository checkout.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Start from' })).not.toBeInTheDocument()

    await selectSourcesAndModel(user)
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))
    const [, request] = mocks.fuseMultiRun.mock.calls[0] as [number, FuseMultiRunRequest]
    expect(request).toMatchObject({ isolate: false })
    expect(request).not.toHaveProperty('baseRef')
  })

  it('forces isolation when a selected source ran in the repository checkout', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockResolvedValue({ ...nonIsolatedRun, fusions: [] })
    renderFuseDialog({ run: nonIsolatedRun })

    expect(screen.getByRole('switch', { name: 'Isolated workspace' })).toBeEnabled()

    await selectSourcesAndModel(user)

    const toggle = screen.getByRole('switch', { name: 'Isolated workspace' })
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
    expect(
      screen.getByText('Isolation is required because a selected result ran in the repository checkout'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => expect(mocks.fuseMultiRun).toHaveBeenCalledTimes(1))
    const [, request] = mocks.fuseMultiRun.mock.calls[0] as [number, FuseMultiRunRequest]
    expect(request).toMatchObject({ isolate: true, baseRef: 'main' })
  })

  it('shows the recovered-attempt message when an earlier fusion is already running', async () => {
    const user = userEvent.setup()
    mocks.fuseMultiRun.mockRejectedValue(
      new FetchError('An earlier fusion attempt is already running', 409, 'FUSION_ATTEMPT_RECOVERED', undefined, {
        details: { fusions: [{ fusionId: 1, sessionId: 'ses_1' }] },
      }),
    )
    renderFuseDialog()

    await selectSourcesAndModel(user)
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(
      await screen.findByText('An earlier attempt is already running. Open it from the Fusions list.'),
    ).toBeInTheDocument()
  })
})
