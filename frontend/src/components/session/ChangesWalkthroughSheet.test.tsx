import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ChangesWalkthroughSheet } from './ChangesWalkthroughSheet'
import { FetchError } from '@/api/fetchWrapper'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'

const mocks = vi.hoisted(() => ({
  getChangeWalkthrough: vi.fn(),
  generateChangeWalkthrough: vi.fn(),
}))

vi.mock('@/api/changeWalkthroughs', () => ({
  getChangeWalkthrough: mocks.getChangeWalkthrough,
  generateChangeWalkthrough: mocks.generateChangeWalkthrough,
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
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a walkthrough and renders the summary and first stop', async () => {
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
    expect(screen.getByText('Stop 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/greet.ts')).toBeInTheDocument()
    expect(screen.getByText('const a = 2')).toBeInTheDocument()
    expect(screen.queryByText('src/main.ts')).not.toBeInTheDocument()
    expect(screen.getByText('assets/logo.png — binary file')).toBeInTheDocument()
  })

  it('moves through the stops with the navigator in order', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state())
    renderSheet()

    expect(await screen.findByText('Stop 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/greet.ts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText('Stop 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()
    expect(screen.queryByText('src/greet.ts')).not.toBeInTheDocument()
    expect(screen.getByText('truncated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /previous/i }))

    expect(await screen.findByText('Stop 1 of 2')).toBeInTheDocument()
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

    await screen.findByText('Stop 1 of 2')
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

  it('shows progress while the server is generating instead of the generate button', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, generating: true }))
    renderSheet()

    expect(await screen.findByText(/Generating walkthrough/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
  })

  it('renders ready and pending stops while generating', async () => {
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

    expect(await screen.findByText('Introduces the greeting helper.')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 stops explained/)).toBeInTheDocument()
    expect(screen.getByLabelText('Explaining')).toBeInTheDocument()
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

  it('renders the no-changes message inline', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, currentDiffHash: null }))
    mocks.generateChangeWalkthrough.mockRejectedValue(
      new FetchError('This session has no changes to walk through', 409, 'WALKTHROUGH_NO_CHANGES'),
    )
    renderSheet()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('This session has no text changes to walk through')).toBeInTheDocument()
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
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: mechanicalWalkthrough }))
    renderSheet()

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
    const { container } = renderSheet()

    expect(await screen.findByText(/Summary/)).toBeInTheDocument()
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
    expect(await screen.findByText('This session has no text changes to walk through')).toBeInTheDocument()

    rerender(<ChangesWalkthroughSheet sessionId="ses_1" open={false} onOpenChange={onOpenChange} />)
    rerender(<ChangesWalkthroughSheet sessionId="ses_1" open onOpenChange={onOpenChange} />)

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    expect(generate).toBeEnabled()
    expect(screen.queryByText('This session has no text changes to walk through')).not.toBeInTheDocument()

    await user.click(generate)

    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
    expect(screen.queryByText('This session has no text changes to walk through')).not.toBeInTheDocument()
  })
})
