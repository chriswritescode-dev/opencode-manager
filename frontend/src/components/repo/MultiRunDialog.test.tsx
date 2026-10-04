import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  useProvidersWithModels: vi.fn(),
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
}))

vi.mock('@/hooks/useProvidersWithModels', () => ({
  useProvidersWithModels: mocks.useProvidersWithModels,
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

describe('MultiRunDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProvidersWithModels.mockReturnValue({ data: providers, isLoading: false })
    mocks.listMultiRuns.mockResolvedValue([])
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
})
