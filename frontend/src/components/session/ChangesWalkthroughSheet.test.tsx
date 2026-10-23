import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ChangesWalkthroughSheet } from './ChangesWalkthroughSheet'
import { FetchError } from '@/api/fetchWrapper'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  getChangeWalkthrough: vi.fn(),
  generateChangeWalkthrough: vi.fn(),
  refineChangeWalkthrough: vi.fn(),
  cancelChangeWalkthrough: vi.fn(),
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
  refineChangeWalkthrough: mocks.refineChangeWalkthrough,
  cancelChangeWalkthrough: mocks.cancelChangeWalkthrough,
}))

const artifactPath = '/workspace/walkthroughs/ses_1/gen/index.html'

const walkthrough: ChangeWalkthrough = {
  sessionId: 'ses_1',
  source: { kind: 'session' },
  diffHash: 'hash-1',
  walkthroughSessionId: 'ses_walk',
  status: 'ready',
  artifactPath,
  publishedAt: 1000,
  executionStartedAt: null,
  error: null,
  model: null,
  createdAt: 1,
  updatedAt: 2,
}

const generatingWalkthrough: ChangeWalkthrough = {
  ...walkthrough,
  status: 'generating',
  artifactPath: null,
  publishedAt: null,
}

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return { walkthrough, currentDiffHash: 'hash-1', hasChanges: true, stale: false, generating: false, running: false, error: null, ...overrides }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof ChangesWalkthroughSheet>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(
    <ChangesWalkthroughSheet sessionId="ses_1" open onOpenChange={onOpenChange} {...overrides} />,
    { wrapper: createWrapper() },
  )
  return { ...view, onOpenChange }
}

describe('ChangesWalkthroughSheet', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
    Element.prototype.scrollTo ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers to generate a walkthrough and starts a walkthrough session', async () => {
    const user = userEvent.setup()
    let generated = false
    mocks.getChangeWalkthrough.mockImplementation(async () =>
      generated ? state() : state({ walkthrough: null }),
    )
    mocks.generateChangeWalkthrough.mockImplementation(async () => {
      generated = true
      return state()
    })
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { source: { kind: 'session' } })
    })
    expect(await screen.findByTitle('Change walkthrough')).toHaveAttribute('sandbox', 'allow-scripts')
  })

  it('generates with the selected model', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet({ model: { providerID: 'anthropic', id: 'claude', variant: 'high' } })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {
        source: { kind: 'session' },
        model: 'anthropic/claude#high',
      })
    })
  })

  it('shows the building status and opens the walkthrough session while generating', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ generating: true, walkthrough: generatingWalkthrough }))
    mocks.cancelChangeWalkthrough.mockResolvedValue(undefined)
    renderSheet({ onOpenSession })

    expect(await screen.findByText('Building the walkthrough in a separate session…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open walkthrough session' }))
    expect(onOpenSession).toHaveBeenCalledWith('ses_walk')

    await user.click(screen.getByRole('button', { name: 'Stop generating walkthrough' }))
    await waitFor(() => {
      expect(mocks.cancelChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'session' })
    })
  })

  it('does not show a stop button when idle', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await screen.findByRole('button', { name: 'Regenerate walkthrough' })
    expect(screen.queryByRole('button', { name: 'Stop generating walkthrough' })).not.toBeInTheDocument()
  })

  it('keeps the stop control and hides the refine form while a published walkthrough is still running', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ running: true }))
    mocks.cancelChangeWalkthrough.mockResolvedValue(undefined)
    renderSheet()

    expect(await screen.findByTitle('Change walkthrough')).toBeInTheDocument()
    expect(screen.getByText('Refining…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Refine walkthrough')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop generating walkthrough' }))
    await waitFor(() => {
      expect(mocks.cancelChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'session' })
    })
  })

  it('shows the refine form and no stop control once the execution ends', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    expect(await screen.findByLabelText('Refine walkthrough')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop generating walkthrough' })).not.toBeInTheDocument()
    expect(screen.queryByText('Refining…')).not.toBeInTheDocument()
  })

  it('renders the published artifact in a sandboxed iframe with the raw file source', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    const frame = await screen.findByTitle('Change walkthrough')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')

    const src = frame.getAttribute('src') ?? ''
    expect(src).toContain('/api/files?')
    expect(src).toContain('raw=true')
    expect(src).toContain(encodeURIComponent(artifactPath))
  })

  it('renders no stop list or page navigation', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await screen.findByTitle('Change walkthrough')
    expect(screen.queryByRole('button', { name: 'Jump to page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('refines a published walkthrough through the walkthrough session', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    mocks.refineChangeWalkthrough.mockResolvedValue(state({ generating: true }))
    renderSheet()

    const textarea = await screen.findByLabelText('Refine walkthrough')
    await user.type(textarea, 'tighten the introduction')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(mocks.refineChangeWalkthrough).toHaveBeenCalledWith('ses_1', {
        source: { kind: 'session' },
        text: 'tighten the introduction',
      })
    })
  })

  it('updates a stale walkthrough', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ stale: true, currentDiffHash: 'hash-2' }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state({ generating: true }))
    renderSheet()

    expect(
      await screen.findByText('Changes have been updated since this walkthrough was generated'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { source: { kind: 'session' } })
    })
  })

  it('regenerates from the header without a stale walkthrough', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await screen.findByTitle('Change walkthrough')
    await user.click(screen.getByRole('button', { name: 'Regenerate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {
        regenerate: true,
        source: { kind: 'session' },
      })
    })
  })

  it('switches to staged changes', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { source: { kind: 'staged' } })
    })
  })

  it('renders the source picker in the drawer header before any walkthrough exists', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    renderSheet()

    const header = screen.getByRole('button', { name: 'Close' }).parentElement
    expect(header).not.toBeNull()
    expect(
      within(header as HTMLElement).getByRole('combobox', { name: 'Changes to walk through' }),
    ).toBeInTheDocument()
  })

  it('sends the branch base', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Branch vs base' }))

    const base = await screen.findByLabelText('Base branch')
    await user.type(base, 'develop')
    await user.tab()

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'branch', base: 'develop' })
    })

    await user.click(screen.getByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {
        source: { kind: 'branch', base: 'develop' },
      })
    })
  })

  it('prompts for a pull request number and withholds the actions until it is valid', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Pull request' }))

    const number = await screen.findByLabelText('Pull request number')
    await user.type(number, '0')
    await user.tab()

    expect(await screen.findByText('Enter a pull request number')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
    expect(mocks.generateChangeWalkthrough).not.toHaveBeenCalled()
    expect(mocks.getChangeWalkthrough).not.toHaveBeenCalledWith(
      'ses_1',
      expect.objectContaining({ kind: 'pullRequest' }),
    )
  })

  it('commits a valid pull request number and restores the generate action', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Pull request' }))

    const number = await screen.findByLabelText('Pull request number')
    await user.type(number, '12')
    await user.tab()

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'pullRequest', number: 12 })
    })
    expect(screen.queryByText('Enter a pull request number')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
  })

  it('resets the source before querying a new session', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    const { rerender, onOpenChange } = renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))
    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })

    rerender(<ChangesWalkthroughSheet sessionId="ses_2" open onOpenChange={onOpenChange} />)

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_2', { kind: 'session' })
    })
    expect(mocks.getChangeWalkthrough).not.toHaveBeenCalledWith('ses_2', { kind: 'staged' })
  })

  it('applies an external source request to the walkthrough source', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    renderSheet({ sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } } })

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })
    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Staged')
  })

  it('applies a pull request request with its number and base', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    renderSheet({
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'pullRequest', number: 12 } },
    })

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'pullRequest', number: 12 })
    })
    expect(screen.getByLabelText('Pull request number')).toHaveValue(12)
  })

  it('re-applies a repeated request for the same source', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    const { rerender, onOpenChange } = renderSheet({
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } },
    })
    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Unstaged' }))
    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'unstaged' })
    })

    rerender(
      <ChangesWalkthroughSheet
        sessionId="ses_1"
        open
        onOpenChange={onOpenChange}
        sourceRequest={{ sessionId: 'ses_1', source: { kind: 'staged' } }}
      />,
    )

    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })
    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Staged')
  })

  it('leaves the current selection when a request carries no source', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    const { rerender, onOpenChange } = renderSheet({
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } },
    })
    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'staged' })
    })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Unstaged' }))
    await waitFor(() => {
      expect(mocks.getChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'unstaged' })
    })
    mocks.getChangeWalkthrough.mockClear()

    rerender(
      <ChangesWalkthroughSheet
        sessionId="ses_1"
        open
        onOpenChange={onOpenChange}
        sourceRequest={{ sessionId: 'ses_1', source: undefined }}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Unstaged')
    expect(mocks.getChangeWalkthrough).not.toHaveBeenCalledWith('ses_1', { kind: 'session' })
    expect(mocks.getChangeWalkthrough).not.toHaveBeenCalledWith('ses_1', { kind: 'staged' })
  })

  it('clears a generation error when the source changes', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null }))
    mocks.generateChangeWalkthrough.mockRejectedValue(
      new FetchError('Not a git repository', 409, 'WALKTHROUGH_NOT_A_REPO'),
    )
    renderSheet()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Branch vs base' }))

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))
    expect(await screen.findByText('Not a git repository')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))

    await waitFor(() => {
      expect(screen.queryByText('Not a git repository')).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('button', { name: 'Generate walkthrough' })).toBeVisible()
  })

  it('shows a loading status while the walkthrough state is loading', async () => {
    mocks.getChangeWalkthrough.mockImplementation(() => new Promise(() => {}))
    renderSheet()

    expect(await screen.findByText('Loading the walkthrough…')).toBeInTheDocument()
  })

  it('renders a generation failure recorded by the server', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: null,
        error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
      }),
    )
    renderSheet()

    expect(
      await screen.findByText('The walkthrough session did not publish within 15 minutes'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
  })

  it('shows an upfront empty state when the session has no changes', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({ walkthrough: null, currentDiffHash: 'e3b0c44298fc1c149afbf4c8996fb924', hasChanges: false }),
    )
    renderSheet()

    expect(await screen.findByText('No changes in this session')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
  })

  it('hides the refine form until a walkthrough is published', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          status: 'failed',
          artifactPath: null,
          publishedAt: null,
          error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
        },
        error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
      }),
    )
    renderSheet()

    expect(
      await screen.findByText('The walkthrough session did not publish within 15 minutes'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Refine walkthrough')).not.toBeInTheDocument()
  })

  it.each([
    ['WALKTHROUGH_NO_CHANGES', 'This session has no changes to walk through', 'This session has no changes to walk through'],
    ['WALKTHROUGH_NO_CHANGES', 'The staged changes contain no changes to walk through', 'The staged changes contain no changes to walk through'],
    ['WALKTHROUGH_NO_TEXT_CHANGES', '', 'This session has no text changes to walk through'],
  ])('renders the %s message for the selected source inline', async (code, serverMessage, shown) => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, currentDiffHash: null }))
    mocks.generateChangeWalkthrough.mockRejectedValue(new FetchError(serverMessage, 409, code))
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText(shown)).toBeInTheDocument()
  })

  it('renders other generation errors inline', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, currentDiffHash: null }))
    mocks.generateChangeWalkthrough.mockRejectedValue(new Error('model exploded'))
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('model exploded')).toBeInTheDocument()
  })

  it.each([
    ['WALKTHROUGH_NO_CHANGES', 'This session has no changes to walk through'],
    ['WALKTHROUGH_NO_TEXT_CHANGES', 'This session has no text changes to walk through'],
  ])('recovers from a prior %s error once changes appear and the dialog is reopened', async (code, serverMessage) => {
    const user = userEvent.setup()
    let generated = false
    mocks.getChangeWalkthrough.mockImplementation(async () =>
      generated ? state() : state({ walkthrough: null, currentDiffHash: null }),
    )
    mocks.generateChangeWalkthrough
      .mockRejectedValueOnce(new FetchError(serverMessage, 409, code))
      .mockImplementationOnce(async () => {
        generated = true
        return state()
      })

    const { rerender, onOpenChange } = renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))
    expect(await screen.findByText(serverMessage)).toBeInTheDocument()

    rerender(<ChangesWalkthroughSheet sessionId="ses_1" open={false} onOpenChange={onOpenChange} />)
    rerender(<ChangesWalkthroughSheet sessionId="ses_1" open onOpenChange={onOpenChange} />)

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    expect(generate).toBeEnabled()
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()

    await user.click(generate)

    expect(await screen.findByTitle('Change walkthrough')).toHaveAttribute('sandbox', 'allow-scripts')
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()
  })
})
