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
  diffHash: 'hash-1',
  summary: 'This change adds a greeting.',
  stops: [
    { title: 'Add the greeting', explanation: 'Introduces the greeting helper.', hunkIds: ['f0h0'] },
    { title: 'Wire it up', explanation: 'Calls the helper from the entry point.', hunkIds: ['f1h0'] },
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
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {})
    })
    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. Add the greeting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2. Wire it up' })).toBeInTheDocument()
    expect(screen.queryByText('src/greet.ts')).not.toBeInTheDocument()
    expect(screen.getByText('assets/logo.png — binary file')).toBeInTheDocument()
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

  it('shows the stale warning and regenerates', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ stale: true, currentDiffHash: 'hash-2' }))
    mocks.generateChangeWalkthrough.mockResolvedValue(state({ generating: true }))
    renderSheet()

    expect(
      await screen.findByText('Changes have been updated since this walkthrough was generated'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { regenerate: true })
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
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { regenerate: true })
    })
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

  it('shows progress while the server is generating instead of the generate button', async () => {
    mocks.getChangeWalkthrough.mockResolvedValue(state({ walkthrough: null, generating: true }))
    renderSheet()

    expect(await screen.findByText(/Generating walkthrough/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
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

  it('renders raw HTML in the summary and stop explanation as inert text', async () => {
    const payload =
      '<iframe srcdoc="&lt;script&gt;parent.document.documentElement.dataset.walkthroughProbe = 1&lt;/script&gt;"></iframe>'
    mocks.getChangeWalkthrough.mockResolvedValue(
      state({
        walkthrough: {
          ...walkthrough,
          summary: `Summary ${payload}`,
          stops: [{ title: 'Stop', explanation: `Explanation ${payload}`, hunkIds: ['f0h0'] }],
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
