import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ChangesWalkthroughDialog } from './ChangesWalkthroughDialog'
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
  return { walkthrough, currentDiffHash: 'hash-1', stale: false, ...overrides }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof ChangesWalkthroughDialog>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(
    <ChangesWalkthroughDialog sessionId="ses_1" open onOpenChange={onOpenChange} {...overrides} />,
    { wrapper: createWrapper() },
  )
  return { ...view, onOpenChange }
}

describe('ChangesWalkthroughDialog', () => {
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
      generated ? state() : { walkthrough: null, currentDiffHash: 'hash-1', stale: false },
    )
    mocks.generateChangeWalkthrough.mockImplementation(async () => {
      generated = true
      return walkthrough
    })
    renderDialog()

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(generate)

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', {})
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
    renderDialog()

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

  it('shows the stale warning and regenerates', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue(state({ stale: true, currentDiffHash: 'hash-2' }))
    mocks.generateChangeWalkthrough.mockResolvedValue(walkthrough)
    renderDialog()

    expect(
      await screen.findByText('Changes have been updated since this walkthrough was generated'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() => {
      expect(mocks.generateChangeWalkthrough).toHaveBeenCalledWith('ses_1', { regenerate: true })
    })
  })

  it('renders the no-changes message inline', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue({ walkthrough: null, currentDiffHash: null, stale: false })
    mocks.generateChangeWalkthrough.mockRejectedValue(
      new FetchError('This session has no changes to walk through', 409, 'WALKTHROUGH_NO_CHANGES'),
    )
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('This session has no text changes to walk through')).toBeInTheDocument()
  })

  it('renders other generation errors inline', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue({ walkthrough: null, currentDiffHash: null, stale: false })
    mocks.generateChangeWalkthrough.mockRejectedValue(new Error('model exploded'))
    renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('model exploded')).toBeInTheDocument()
  })

  it('lists the omitted files when the diff is too large to walk through', async () => {
    const user = userEvent.setup()
    mocks.getChangeWalkthrough.mockResolvedValue({ walkthrough: null, currentDiffHash: null, stale: false })
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
    renderDialog()

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
    const { container } = renderDialog()

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
      generated ? state() : { walkthrough: null, currentDiffHash: null, stale: false },
    )
    mocks.generateChangeWalkthrough
      .mockRejectedValueOnce(new FetchError(serverMessage, 409, code))
      .mockImplementationOnce(async () => {
        generated = true
        return walkthrough
      })

    const { rerender, onOpenChange } = renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))
    expect(await screen.findByText('This session has no text changes to walk through')).toBeInTheDocument()

    rerender(<ChangesWalkthroughDialog sessionId="ses_1" open={false} onOpenChange={onOpenChange} />)
    rerender(<ChangesWalkthroughDialog sessionId="ses_1" open onOpenChange={onOpenChange} />)

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    expect(generate).toBeEnabled()
    expect(screen.queryByText('This session has no text changes to walk through')).not.toBeInTheDocument()

    await user.click(generate)

    expect(await screen.findByText('This change adds a greeting.')).toBeInTheDocument()
    expect(screen.queryByText('This session has no text changes to walk through')).not.toBeInTheDocument()
  })
})
