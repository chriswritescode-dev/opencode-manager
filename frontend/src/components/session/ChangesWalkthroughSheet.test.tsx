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
  cancelChangeWalkthrough: vi.fn(),
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
  cancelChangeWalkthrough: mocks.cancelChangeWalkthrough,
}))

const walkthrough: ChangeWalkthrough = {
  sessionId: 'ses_1',
  source: { kind: 'session' },
  diffHash: 'hash-1',
  model: null,
  summary: 'This change adds a greeting.',
  stops: [
    {
      id: 's_greet',
      title: 'Add the greeting',
      explanation: 'Introduces the greeting helper.',
      hunkIds: ['f0h0'],
      status: 'ready',
      explanationKey: null,
    },
    {
      id: 's_wire',
      title: 'Wire it up',
      explanation: 'Calls the helper from the entry point.',
      hunkIds: ['f1h0'],
      status: 'ready',
      explanationKey: null,
    },
  ],
  hunks: [
    {
      id: 'f0h0',
      file: 'src/greet.ts',
      status: 'modified',
      header: '@@ -1 +1 @@',
      text: '@@ -1 +1 @@\n-const a = 1\n+const a = 2',
      truncated: false,
    },
    {
      id: 'f1h0',
      file: 'src/main.ts',
      status: 'added',
      header: '@@ -0,0 +1 @@',
      text: '@@ -0,0 +1 @@\n+const b = 3',
      truncated: true,
    },
  ],
  omittedFiles: [{ file: 'assets/logo.png', reason: 'binary' }],
  createdAt: 1,
}

const mechanicalWalkthrough: ChangeWalkthrough = {
  ...walkthrough,
  stops: [
    {
      id: 's_mech',
      title: 'Mechanical changes',
      explanation: 'Lock files, snapshots and generated files.',
      hunkIds: ['m_lock', 'm_snap', 'm_map'],
      status: 'ready',
      explanationKey: null,
    },
  ],
  hunks: [
    {
      id: 'm_lock',
      file: 'pnpm-lock.yaml',
      status: 'modified',
      header: '@@ -1 +1 @@',
      text: '@@ -1 +1 @@\n-old-lock\n+new-lock',
      truncated: false,
      additions: 120,
      deletions: 80,
    },
    {
      id: 'm_snap',
      file: 'src/__snapshots__/a.ts.snap',
      status: 'added',
      header: '',
      text: '',
      truncated: true,
      additions: 5,
      deletions: 0,
    },
    {
      id: 'm_map',
      file: 'dist/app.js.map',
      status: 'deleted',
      header: '',
      text: '',
      truncated: true,
      additions: 0,
      deletions: 7,
    },
  ],
  omittedFiles: [],
}

function state(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return { walkthrough, currentDiffHash: 'hash-1', stale: false, generating: false, error: null, ...overrides }
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

  it('generates a walkthrough and opens on the overview page', async () => {
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

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(generate)

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { source: { kind: 'session' } })
    })
    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. Add the greeting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2. Wire it up' })).toBeInTheDocument()
    expect(screen.queryByText('src/greet.ts')).not.toBeInTheDocument()
    expect(screen.getByText('assets/logo.png — binary file')).toBeInTheDocument()
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

  it('opens a stop from the overview list without the summary or list', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(await screen.findByRole('button', { name: '2. Wire it up' }))

    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()
    expect(screen.queryByText('This change adds a greeting.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1. Add the greeting' })).not.toBeInTheDocument()
  })

  it('jumps between pages from the header dropdown', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await user.click(await screen.findByRole('button', { name: '1. Add the greeting' }))
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Jump to page' }))
    await user.click(await screen.findByRole('menuitemradio', { name: '2. Wire it up' }))
    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Jump to page' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Overview' }))
    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
  })

  it('moves through the overview and stops with the navigator in order', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/greet.ts')).toBeInTheDocument()
    expect(screen.getByText('const a = 2')).toBeInTheDocument()
    expect(screen.queryByText('This change adds a greeting.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()
    expect(screen.queryByText('src/greet.ts')).not.toBeInTheDocument()
    expect(screen.getByText('truncated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /previous/i }))
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /previous/i }))
    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('This change adds a greeting.')).toBeInTheDocument()
  })

  it('updates a stale walkthrough incrementally', async () => {
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

    await screen.findByText('Overview')
    await user.click(screen.getByRole('button', { name: 'Regenerate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {
        regenerate: true,
        source: { kind: 'session' },
      })
    })
  })

  it('stops an in-flight generation from the header', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ generating: true }))
    mocks.cancelChangeWalkthrough.mockResolvedValue(undefined)
    renderSheet()

    const stop = await screen.findByRole('button', { name: 'Stop generating walkthrough' })
    await user.click(stop)

    await waitFor(() => {
      expect(mocks.cancelChangeWalkthrough).toHaveBeenCalledWith('ses_1', { kind: 'session' })
    })
  })

  it('does not show a stop button when idle', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    await screen.findByText('Overview')
    expect(screen.queryByRole('button', { name: 'Stop generating walkthrough' })).not.toBeInTheDocument()
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

  it('scrolls back to the top of the overview when a walkthrough is regenerated', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo')
    let createdAt = 1
    mocks.getChangeWalkthrough.mockImplementation(async () => state({ walkthrough: { ...walkthrough, createdAt } }))
    mocks.generateChangeWalkthrough.mockImplementation(async () => {
      createdAt = 2
      return state({ walkthrough: { ...walkthrough, createdAt } })
    })
    renderSheet()

    await user.click(await screen.findByRole('button', { name: '1. Add the greeting' }))
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()

    scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Regenerate walkthrough' }))

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }))
    expect(await screen.findByText('Overview')).toBeInTheDocument()
  })

  it('shows a skeleton and planning status while the server is generating without stops', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, generating: true }))
    renderSheet()

    expect(await screen.findByText('Planning the walkthrough…')).toBeInTheDocument()
    expect(screen.getByTestId('walkthrough-skeleton')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Generating walkthrough/)).not.toBeInTheDocument()
  })

  it('shows a skeleton while the walkthrough state is loading', async () => {
    mocks.getChangeWalkthrough.mockImplementation(() => new Promise(() => {}))
    renderSheet()

    expect(await screen.findByText('Loading the walkthrough…')).toBeInTheDocument()
    expect(screen.getByTestId('walkthrough-skeleton')).toBeInTheDocument()
  })

  it('shows a stop body skeleton while its explanation is pending', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        generating: true,
        walkthrough: {
          ...walkthrough,
          stops: [
            { ...walkthrough.stops[0], status: 'ready' },
            { ...walkthrough.stops[1], status: 'pending', explanation: '' },
          ],
        },
      }),
    )
    renderSheet()

    await user.click(await screen.findByRole('button', { name: /2\. Wire it up/ }))

    expect(await screen.findByText('Explaining this stop…')).toBeInTheDocument()
    expect(screen.getByTestId('walkthrough-skeleton')).toBeInTheDocument()
  })

  it('renders ready and pending stops while generating', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        generating: true,
        walkthrough: {
          ...walkthrough,
          stops: [
            { ...walkthrough.stops[0], status: 'ready' },
            { ...walkthrough.stops[1], status: 'pending', explanation: '' },
          ],
        },
      }),
    )
    renderSheet()

    expect(await screen.findByText(/1 of 2 stops explained/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. Add the greeting' })).toBeInTheDocument()
    expect(screen.getByLabelText('Explaining')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '1. Add the greeting' }))
    expect(await screen.findByText('Introduces the greeting helper.')).toBeInTheDocument()
  })

  it('retries unexplained stops', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          stops: [
            { ...walkthrough.stops[0], status: 'failed', explanation: '' },
            { ...walkthrough.stops[1], status: 'ready' },
          ],
        },
      }),
    )
    mocks.generateChangeWalkthrough.mockResolvedValue(state({ generating: true }))
    renderSheet()

    await user.click(await screen.findByRole('button', { name: /1\. Add the greeting/ }))
    expect(await screen.findByText('This stop could not be explained.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry unexplained stops' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { source: { kind: 'session' } })
    })
  })

  it('renders a generation failure recorded by the server', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: null,
        error: { message: 'The model did not return a usable change walkthrough', code: 'WALKTHROUGH_UNPARSEABLE' },
      }),
    )
    renderSheet()

    expect(await screen.findByText('The model did not return a usable change walkthrough')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
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

  it('lists the omitted files when the diff is too large to walk through', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, currentDiffHash: null }))
    mocks.generateChangeWalkthrough.mockRejectedValue(
      new FetchError('These changes are too large to walk through', 413, 'WALKTHROUGH_CONTEXT_LIMIT', undefined, {
        details: {
          omittedFiles: [
            { file: 'src/big.ts', reason: 'budget' },
            { file: 'assets/logo.png', reason: 'binary' },
          ],
        },
      }),
    )
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('These changes are too large to walk through')).toBeInTheDocument()
    expect(screen.getByText('src/big.ts — over the diff budget')).toBeInTheDocument()
    expect(screen.getByText('assets/logo.png — binary file')).toBeInTheDocument()
  })

  it('labels renamed and mode-change omitted files', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          omittedFiles: [
            { file: 'src/old.ts', reason: 'renamed' },
            { file: 'script.sh', reason: 'modeChange' },
          ],
        },
      }),
    )
    renderSheet()

    expect(await screen.findByText('src/old.ts — renamed')).toBeInTheDocument()
    expect(screen.getByText('script.sh — mode change')).toBeInTheDocument()
  })

  it('renders mechanical files as a compact summary list with counts and diff text for budgeted hunks', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: mechanicalWalkthrough }))
    renderSheet()

    await user.click(await screen.findByRole('button', { name: '1. Mechanical changes' }))
    expect(
      await screen.findByRole('list', { name: 'Mechanical file summaries' }),
    ).toBeInTheDocument()
    expect(screen.getByText('pnpm-lock.yaml')).toBeInTheDocument()
    expect(screen.getByText('src/__snapshots__/a.ts.snap')).toBeInTheDocument()
    expect(screen.getByText('dist/app.js.map')).toBeInTheDocument()
    expect(screen.getByText('+120')).toBeInTheDocument()
    expect(screen.getByText('-80')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('-7')).toBeInTheDocument()
    expect(screen.getByText('new-lock')).toBeInTheDocument()
  })

  it('renders a stored mechanical stop whose hunks predate hunk counts', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          stops: [
            {
              id: 's_mech',
              title: 'Mechanical changes',
              explanation: 'Lock files',
              hunkIds: ['m_lock'],
              status: 'ready',
              explanationKey: null,
            },
          ],
          hunks: [
            {
              id: 'm_lock',
              file: 'pnpm-lock.yaml',
              status: 'modified',
              header: '@@ -1 +1 @@',
              text: '@@ -1 +1 @@\n-old-lock\n+new-lock',
              truncated: false,
            },
          ],
          omittedFiles: [],
        },
      }),
    )
    renderSheet()

    await user.click(await screen.findByRole('button', { name: '1. Mechanical changes' }))
    expect(await screen.findByText('pnpm-lock.yaml')).toBeInTheDocument()
    expect(screen.getByText('new-lock')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Mechanical file summaries' })).not.toBeInTheDocument()
  })

  it('renders raw HTML in the summary and stop explanation as inert text', async () => {
    const payload =
      '<iframe srcdoc="&lt;script&gt;parent.document.documentElement.dataset.walkthroughProbe = 1&lt;/script&gt;"></iframe>'
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          summary: `Summary ${payload}`,
          stops: [
            { id: 's_x', title: 'Stop', explanation: `Explanation ${payload}`, hunkIds: ['f0h0'], status: 'ready', explanationKey: null },
          ],
        },
      }),
    )
    const user = userEvent.setup()
    const { container } = renderSheet()

    expect(await screen.findByText(/Summary/)).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText(/Explanation/)).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(document.documentElement.dataset.walkthroughProbe).toBeUndefined()
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

    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()
  })
})
