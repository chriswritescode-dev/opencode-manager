import { useReducer } from 'react'
import { describe, it, expect, beforeAll } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import type { ChangeWalkthrough, ChangeWalkthroughState } from '@opencode-manager/shared/schemas'
import { ChangesWalkthroughSheet } from './ChangesWalkthroughSheet'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

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

function makeState(overrides: Partial<ChangeWalkthroughState> = {}): ChangeWalkthroughState {
  return {
    walkthrough,
    currentDiffHash: 'hash-1',
    hasChanges: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

function stateOf(overrides: Partial<ChangeWalkthroughState> = {}) {
  return () => ({ json: makeState(overrides) })
}

interface WalkthroughFixture {
  state?: () => FetchRouteResult | Promise<FetchRouteResult>
  generate?: () => FetchRouteResult | Promise<FetchRouteResult>
  refine?: () => FetchRouteResult | Promise<FetchRouteResult>
  cancel?: () => FetchRouteResult | Promise<FetchRouteResult>
}

type SheetProps = ComponentProps<typeof ChangesWalkthroughSheet>

function walkthroughRoutes(fixture: WalkthroughFixture): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/change-walkthroughs/helper-sessions', respond: () => ({ json: { sessionIds: [] } }) },
    {
      method: 'GET',
      path: '/api/change-walkthroughs/:sessionId',
      respond: () => (fixture.state ?? stateOf())(),
    },
    {
      method: 'POST',
      path: '/api/change-walkthroughs/:sessionId',
      respond: () => fixture.generate?.() ?? { json: makeState() },
    },
    {
      method: 'POST',
      path: '/api/change-walkthroughs/:sessionId/refine',
      respond: () => fixture.refine?.() ?? { json: makeState() },
    },
    {
      method: 'DELETE',
      path: '/api/change-walkthroughs/:sessionId',
      respond: () => fixture.cancel?.() ?? { status: 204 },
    },
  ]
}

function renderSheet(fixture: WalkthroughFixture = {}, overrides: Partial<SheetProps> = {}) {
  const active: SheetProps = { sessionId: 'ses_1', open: true, onOpenChange: () => {}, ...overrides }
  const harness = { rerender: () => {} }

  function Harness() {
    const [, force] = useReducer((count: number) => count + 1, 0)
    harness.rerender = force
    return <ChangesWalkthroughSheet {...active} />
  }

  const result = renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: walkthroughRoutes(fixture),
  })

  return {
    ...result,
    rerenderWith: async (update: Partial<SheetProps>) => {
      Object.assign(active, update)
      await act(async () => {
        harness.rerender()
      })
    },
  }
}

function requestedSources(fixture: ReturnType<typeof renderSheet>): string[] {
  return fixture.fetchFake
    .findRequests('GET', '/api/change-walkthroughs/:sessionId')
    .map((request) => request.searchParams.get('source') ?? '')
}

describe('ChangesWalkthroughSheet', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
    Element.prototype.scrollTo ??= () => {}
  })

  it('offers to generate a walkthrough and starts a walkthrough session', async () => {
    const user = userEvent.setup()
    let generated = false
    const result = renderSheet({
      state: () => ({ json: makeState({ walkthrough: generated ? walkthrough : null }) }),
      generate: () => {
        generated = true
        return { json: makeState() }
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        source: { kind: 'session' },
      }),
    )
    expect(await screen.findByTitle('Change walkthrough')).toHaveAttribute('sandbox', 'allow-scripts')
  })

  it('generates with the selected model', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) }, {
      model: { providerID: 'anthropic', id: 'claude', variant: 'high' },
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        source: { kind: 'session' },
        model: 'anthropic/claude#high',
      }),
    )
  })

  it('shows the building status and opens the walkthrough session while generating', async () => {
    const user = userEvent.setup()
    let openedSession: string | undefined
    const result = renderSheet({ state: stateOf({ generating: true, walkthrough: generatingWalkthrough }) }, {
      onOpenSession: (sessionId: string) => { openedSession = sessionId },
    })

    expect(await screen.findByText('Building the walkthrough in a separate session…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open walkthrough session' }))
    expect(openedSession).toBe('ses_walk')

    await user.click(screen.getByRole('button', { name: 'Stop generating walkthrough' }))
    await waitFor(() =>
      expect(result.fetchFake.lastRequest('DELETE', '/api/change-walkthroughs/:sessionId')?.searchParams.get('source')).toBe(
        'session',
      ),
    )
  })

  it('does not show a stop button when idle', async () => {
    renderSheet()

    await screen.findByRole('button', { name: 'Regenerate walkthrough' })
    expect(screen.queryByRole('button', { name: 'Stop generating walkthrough' })).not.toBeInTheDocument()
  })

  it('keeps the stop control and hides the refine form while a published walkthrough is still running', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ running: true }) })

    expect(await screen.findByTitle('Change walkthrough')).toBeInTheDocument()
    expect(screen.getByText('Refining…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Refine walkthrough')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop generating walkthrough' }))
    await waitFor(() =>
      expect(result.fetchFake.lastRequest('DELETE', '/api/change-walkthroughs/:sessionId')?.searchParams.get('source')).toBe(
        'session',
      ),
    )
  })

  it('shows the refine form and no stop control once the execution ends', async () => {
    renderSheet()

    expect(await screen.findByLabelText('Refine walkthrough')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop generating walkthrough' })).not.toBeInTheDocument()
    expect(screen.queryByText('Refining…')).not.toBeInTheDocument()
  })

  it('renders the published artifact in a sandboxed iframe with the raw file source', async () => {
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
    renderSheet()

    await screen.findByTitle('Change walkthrough')
    expect(screen.queryByRole('button', { name: 'Jump to page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('refines a published walkthrough through the walkthrough session', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ refine: () => ({ json: makeState({ generating: true }) }) })

    const textarea = await screen.findByLabelText('Refine walkthrough')
    await user.type(textarea, 'tighten the introduction')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId/refine')?.body).toEqual({
        source: { kind: 'session' },
        text: 'tighten the introduction',
      }),
    )
  })

  it('updates a stale walkthrough', async () => {
    const user = userEvent.setup()
    const result = renderSheet({
      state: stateOf({ stale: true, currentDiffHash: 'hash-2' }),
      generate: () => ({ json: makeState({ generating: true }) }),
    })

    expect(await screen.findByText('Changes have been updated since this walkthrough was generated')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        source: { kind: 'session' },
      }),
    )
  })

  it('regenerates from the header without a stale walkthrough', async () => {
    const user = userEvent.setup()
    const result = renderSheet()

    await screen.findByTitle('Change walkthrough')
    await user.click(screen.getByRole('button', { name: 'Regenerate walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        regenerate: true,
        source: { kind: 'session' },
      }),
    )
  })

  it('switches to staged changes', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))

    await waitFor(() => expect(requestedSources(result)).toContain('staged'))

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        source: { kind: 'staged' },
      }),
    )
  })

  it('renders the source picker in the drawer header before any walkthrough exists', async () => {
    renderSheet({ state: stateOf({ walkthrough: null }) })

    const header = screen.getByRole('button', { name: 'Close' }).parentElement
    if (!(header instanceof HTMLElement)) throw new Error('drawer header is not rendered')
    expect(within(header).getByRole('combobox', { name: 'Changes to walk through' })).toBeInTheDocument()
  })

  it('sends the branch base', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Branch vs base' }))

    const base = await screen.findByLabelText('Base branch')
    await user.type(base, 'develop')
    await user.tab()

    await waitFor(() => expect(requestedSources(result)).toContain('branch:develop'))

    await user.click(screen.getByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('POST', '/api/change-walkthroughs/:sessionId')?.body).toEqual({
        source: { kind: 'branch', base: 'develop' },
      }),
    )
  })

  it('prompts for a pull request number and withholds the actions until it is valid', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Pull request' }))

    const number = await screen.findByLabelText('Pull request number')
    await user.type(number, '0')
    await user.tab()

    expect(await screen.findByText('Enter a pull request number')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
    expect(result.fetchFake.findRequests('POST', '/api/change-walkthroughs/:sessionId')).toHaveLength(0)
    expect(requestedSources(result).some((source) => source.startsWith('pr:'))).toBe(false)
  })

  it('commits a valid pull request number and restores the generate action', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Pull request' }))

    const number = await screen.findByLabelText('Pull request number')
    await user.type(number, '12')
    await user.tab()

    await waitFor(() => expect(requestedSources(result)).toContain('pr:12:'))
    expect(screen.queryByText('Enter a pull request number')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
  })

  it('resets the source before querying a new session', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))
    await waitFor(() => expect(requestedSources(result)).toContain('staged'))

    await result.rerenderWith({ sessionId: 'ses_2' })

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('GET', '/api/change-walkthroughs/:sessionId')?.path).toBe(
        '/api/change-walkthroughs/ses_2',
      ),
    )
    expect(result.fetchFake.lastRequest('GET', '/api/change-walkthroughs/:sessionId')?.searchParams.get('source')).toBe('session')
  })

  it('applies an external source request to the walkthrough source', async () => {
    const result = renderSheet({ state: stateOf({ walkthrough: null }) }, {
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } },
    })

    await waitFor(() => expect(requestedSources(result)).toContain('staged'))
    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Staged')
  })

  it('applies a pull request request with its number and base', async () => {
    const result = renderSheet({ state: stateOf({ walkthrough: null }) }, {
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'pullRequest', number: 12 } },
    })

    await waitFor(() => expect(requestedSources(result)).toContain('pr:12:'))
    expect(screen.getByLabelText('Pull request number')).toHaveValue(12)
  })

  it('re-applies a repeated request for the same source', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) }, {
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } },
    })
    await waitFor(() => expect(requestedSources(result)).toContain('staged'))

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Unstaged' }))
    await waitFor(() => expect(requestedSources(result)).toContain('unstaged'))

    await result.rerenderWith({ sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } } })

    await waitFor(() => expect(requestedSources(result)).toContain('staged'))
    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Staged')
  })

  it('leaves the current selection when a request carries no source', async () => {
    const user = userEvent.setup()
    const result = renderSheet({ state: stateOf({ walkthrough: null }) }, {
      sourceRequest: { sessionId: 'ses_1', source: { kind: 'staged' } },
    })
    await waitFor(() => expect(requestedSources(result)).toContain('staged'))

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Unstaged' }))
    await waitFor(() => expect(requestedSources(result)).toContain('unstaged'))
    const requestsBefore = requestedSources(result).length

    await result.rerenderWith({ sourceRequest: { sessionId: 'ses_1', source: undefined } })

    expect(screen.getByRole('combobox', { name: 'Changes to walk through' })).toHaveTextContent('Unstaged')
    expect(requestedSources(result)).toHaveLength(requestsBefore)
  })

  it('clears a generation error when the source changes', async () => {
    const user = userEvent.setup()
    renderSheet({
      state: stateOf({ walkthrough: null }),
      generate: () => ({ status: 409, json: { error: 'Not a git repository', code: 'WALKTHROUGH_NOT_A_REPO' } }),
    })

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Branch vs base' }))

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))
    expect(await screen.findByText('Not a git repository')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Changes to walk through' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))

    await waitFor(() => expect(screen.queryByText('Not a git repository')).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: 'Generate walkthrough' })).toBeVisible()
  })

  it('shows a loading status while the walkthrough state is loading', async () => {
    renderSheet({ state: () => new Promise<FetchRouteResult>(() => {}) })

    expect(await screen.findByText('Loading the walkthrough…')).toBeInTheDocument()
  })

  it('renders a generation failure recorded by the server', async () => {
    renderSheet({
      state: stateOf({
        walkthrough: null,
        error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
      }),
    })

    expect(await screen.findByText('The walkthrough session did not publish within 15 minutes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
  })

  it('shows an upfront empty state when the session has no changes', async () => {
    renderSheet({
      state: stateOf({ walkthrough: null, currentDiffHash: 'e3b0c44298fc1c149afbf4c8996fb924', hasChanges: false }),
    })

    expect(await screen.findByText('No changes in this session')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).not.toBeInTheDocument()
  })

  it('hides the refine form until a walkthrough is published', async () => {
    renderSheet({
      state: stateOf({
        walkthrough: {
          ...walkthrough,
          status: 'failed',
          artifactPath: null,
          publishedAt: null,
          error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
        },
        error: { message: 'The walkthrough session did not publish within 15 minutes', code: 'WALKTHROUGH_TIMEOUT' },
      }),
    })

    expect(await screen.findByText('The walkthrough session did not publish within 15 minutes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Refine walkthrough')).not.toBeInTheDocument()
  })

  it.each([
    ['WALKTHROUGH_NO_CHANGES', 'This session has no changes to walk through'],
    ['WALKTHROUGH_NO_CHANGES', 'The staged changes contain no changes to walk through'],
  ])('renders the %s message for the selected source inline', async (code, serverMessage) => {
    const user = userEvent.setup()
    renderSheet({
      state: stateOf({ walkthrough: null, currentDiffHash: null }),
      generate: () => ({ status: 409, json: { error: serverMessage, code } }),
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText(serverMessage)).toBeInTheDocument()
  })

  it('falls back to a no-text-changes message when the server records none', async () => {
    renderSheet({
      state: stateOf({
        walkthrough: null,
        currentDiffHash: null,
        error: { message: '', code: 'WALKTHROUGH_NO_TEXT_CHANGES' },
      }),
    })

    expect(await screen.findByText('This session has no text changes to walk through')).toBeInTheDocument()
  })

  it('renders other generation errors inline', async () => {
    const user = userEvent.setup()
    renderSheet({
      state: stateOf({ walkthrough: null, currentDiffHash: null }),
      generate: () => {
        throw new Error('model exploded')
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))

    expect(await screen.findByText('model exploded')).toBeInTheDocument()
  })

  it.each([
    ['WALKTHROUGH_NO_CHANGES', 'This session has no changes to walk through'],
    ['WALKTHROUGH_NO_TEXT_CHANGES', 'This session has no text changes to walk through'],
  ])('recovers from a prior %s error once changes appear and the dialog is reopened', async (code, serverMessage) => {
    const user = userEvent.setup()
    let generated = false
    let generateCalls = 0
    const result = renderSheet({
      state: () => ({ json: makeState(generated ? {} : { walkthrough: null, currentDiffHash: null }) }),
      generate: () => {
        generateCalls += 1
        if (generateCalls === 1) return { status: 409, json: { error: serverMessage, code } }
        generated = true
        return { json: makeState() }
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Generate walkthrough' }))
    expect(await screen.findByText(serverMessage)).toBeInTheDocument()

    await result.rerenderWith({ open: false })
    await result.rerenderWith({ open: true })

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    expect(generate).toBeEnabled()
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()

    await user.click(generate)

    expect(await screen.findByTitle('Change walkthrough')).toHaveAttribute('sandbox', 'allow-scripts')
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()
  })
})
