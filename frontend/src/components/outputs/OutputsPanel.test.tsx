import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  WALKTHROUGH_OUTPUT_DEFINITION,
} from '@opencode-manager/shared/schemas'
import type { OutputDefinition, OutputRecord, OutputState } from '@opencode-manager/shared/schemas'
import { OutputsPanel } from './OutputsPanel'
import type { OutputsPanelProps } from './OutputsPanel'
import { FetchError } from '@/api/fetchWrapper'

const mocks = vi.hoisted(() => ({
  getOutputState: vi.fn(),
  generateOutput: vi.fn(),
  refineOutput: vi.fn(),
  cancelOutput: vi.fn(),
  getOutputData: vi.fn(),
  getOutputHelperSessionIds: vi.fn(),
  listOutputDefinitions: vi.fn(),
  createOutputDefinition: vi.fn(),
  putOutputDefinition: vi.fn(),
  deleteOutputDefinition: vi.fn(),
  promoteOutputDefinition: vi.fn(),
}))

vi.mock('@/api/outputs', () => ({
  getOutputState: mocks.getOutputState,
  generateOutput: mocks.generateOutput,
  refineOutput: mocks.refineOutput,
  cancelOutput: mocks.cancelOutput,
  getOutputData: mocks.getOutputData,
  getOutputHelperSessionIds: mocks.getOutputHelperSessionIds,
}))

vi.mock('@/api/outputDefinitions', () => ({
  listOutputDefinitions: mocks.listOutputDefinitions,
  createOutputDefinition: mocks.createOutputDefinition,
  putOutputDefinition: mocks.putOutputDefinition,
  deleteOutputDefinition: mocks.deleteOutputDefinition,
  promoteOutputDefinition: mocks.promoteOutputDefinition,
}))

const SUMMARY_DEFINITION: OutputDefinition = {
  id: 'summary',
  label: 'Summary',
  description: 'A summary of the changes.',
  icon: 'FileText',
  params: [],
  instructions: 'Summarize the changes.',
  renderer: { kind: 'html' },
  generation: 'separateSession',
  origin: 'global',
}

const SESSION_REPORT_DEFINITION: OutputDefinition = {
  id: 'session-report',
  label: 'Session report',
  description: 'A report of this session.',
  icon: 'ClipboardList',
  params: [],
  instructions: 'Write a report of this session.',
  renderer: { kind: 'html' },
  generation: 'currentSession',
  origin: 'session',
}

const DEFINITIONS = [WALKTHROUGH_OUTPUT_DEFINITION, SUMMARY_DEFINITION, SESSION_REPORT_DEFINITION]

function definitionById(id: string): OutputDefinition {
  return DEFINITIONS.find((definition) => definition.id === id) ?? WALKTHROUGH_OUTPUT_DEFINITION
}

function state(definition: OutputDefinition, overrides: Partial<OutputState> = {}): OutputState {
  return {
    definition,
    output: null,
    currentInputHash: 'hash-1',
    hasInput: true,
    stale: false,
    generating: false,
    running: false,
    error: null,
    ...overrides,
  }
}

function outputRecord(definitionId: string, overrides: Partial<OutputRecord> = {}): OutputRecord {
  return {
    sessionId: 'ses_1',
    definitionId,
    paramsKey: '{}',
    params: {},
    inputHash: 'hash-1',
    generatorSessionId: 'ses_gen',
    status: 'ready',
    outputDir: '/workspace/outputs/ses_1/gen',
    publishedAt: 1000,
    executionStartedAt: null,
    error: null,
    model: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderPanel(overrides: Partial<OutputsPanelProps> = {}) {
  const onDefinitionChange = overrides.onDefinitionChange ?? vi.fn()
  const onOpenSession = overrides.onOpenSession ?? vi.fn()
  const view = render(
    <OutputsPanel
      sessionId="ses_1"
      definitionId="walkthrough"
      onDefinitionChange={onDefinitionChange}
      onOpenSession={onOpenSession}
      {...overrides}
    />,
    { wrapper: createWrapper() },
  )
  return { ...view, onDefinitionChange, onOpenSession }
}

describe('OutputsPanel', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
    Element.prototype.scrollTo ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listOutputDefinitions.mockResolvedValue(DEFINITIONS)
    mocks.getOutputState.mockImplementation(
      async (_sessionId: string, definitionId: string) => state(definitionById(definitionId)),
    )
    mocks.generateOutput.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, { generating: true }),
    )
    mocks.refineOutput.mockResolvedValue(state(WALKTHROUGH_OUTPUT_DEFINITION))
    mocks.cancelOutput.mockResolvedValue(undefined)
    mocks.getOutputData.mockResolvedValue({})
    mocks.getOutputHelperSessionIds.mockResolvedValue([])
    mocks.promoteOutputDefinition.mockResolvedValue(WALKTHROUGH_OUTPUT_DEFINITION)
  })

  it('lists built-in, global and session definitions', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('combobox', { name: 'Output definition' }))

    expect(await screen.findByRole('option', { name: 'Walkthrough' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Session report' })).toBeInTheDocument()
  })

  it('generates with the selected model', async () => {
    const user = userEvent.setup()
    renderPanel({ model: { providerID: 'anthropic', id: 'claude', variant: 'high' } })

    const generate = await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(generate)

    await waitFor(() => {
      expect(mocks.generateOutput).toHaveBeenCalledWith('ses_1', {
        definitionId: 'walkthrough',
        params: { source: { kind: 'session' } },
        model: 'anthropic/claude#high',
      })
    })
  })

  it('switching definitions loads that output state', async () => {
    const user = userEvent.setup()
    const { rerender, onDefinitionChange } = renderPanel()

    await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(screen.getByRole('combobox', { name: 'Output definition' }))
    await user.click(await screen.findByRole('option', { name: 'Summary' }))

    expect(onDefinitionChange).toHaveBeenCalledWith('summary')

    rerender(
      <OutputsPanel
        sessionId="ses_1"
        definitionId="summary"
        onDefinitionChange={onDefinitionChange}
      />,
    )

    await waitFor(() => {
      expect(mocks.getOutputState).toHaveBeenCalledWith('ses_1', 'summary', {})
    })
  })

  it('shows no generation controls for currentSession definitions', async () => {
    renderPanel({ definitionId: 'session-report' })

    expect(await screen.findByText('Ask the agent in this chat to publish it')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate session report' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Regenerate session report' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Stop generating session report' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Refine session report')).not.toBeInTheDocument()
  })

  it('renders a published currentSession html output without generate controls', async () => {
    mocks.getOutputState.mockResolvedValue(
      state(SESSION_REPORT_DEFINITION, { output: outputRecord('session-report') }),
    )
    renderPanel({ definitionId: 'session-report' })

    const frame = await screen.findByTitle('Session report')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(screen.queryByRole('button', { name: 'Generate session report' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Refine session report')).not.toBeInTheDocument()
  })

  it('saves a session definition as global and retries a clashing id with replace', async () => {
    const user = userEvent.setup()
    mocks.promoteOutputDefinition
      .mockRejectedValueOnce(new FetchError('exists', 409, 'OUTPUT_DEFINITION_EXISTS'))
      .mockResolvedValueOnce(SESSION_REPORT_DEFINITION)
    renderPanel({ definitionId: 'session-report' })

    await user.click(await screen.findByRole('button', { name: 'Save as global' }))

    expect(
      await screen.findByText('Replace the global "session-report" output?'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Replace' }))

    await waitFor(() => {
      expect(mocks.promoteOutputDefinition).toHaveBeenLastCalledWith({
        sessionId: 'ses_1',
        id: 'session-report',
        replace: true,
      })
    })
  })

  it('renders a published html output in a sandboxed iframe with the raw file source', async () => {
    mocks.getOutputState.mockResolvedValue(
      state(SUMMARY_DEFINITION, { output: outputRecord('summary') }),
    )
    renderPanel({ definitionId: 'summary' })

    const frame = await screen.findByTitle('Summary')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')

    const src = frame.getAttribute('src') ?? ''
    expect(src).toContain('/api/files?')
    expect(src).toContain('raw=true')
    expect(src).toContain(encodeURIComponent('/workspace/outputs/ses_1/gen/index.html'))
  })

  it('shows the building status and opens the generating session while generating', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    mocks.getOutputState.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, {
        generating: true,
        output: outputRecord('walkthrough', {
          status: 'generating',
          publishedAt: null,
          outputDir: null,
        }),
      }),
    )
    renderPanel({ onOpenSession })

    expect(
      await screen.findByText('Building the walkthrough in a separate session…'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open walkthrough session' }))
    expect(onOpenSession).toHaveBeenCalledWith('ses_gen')

    await user.click(screen.getByRole('button', { name: 'Stop generating walkthrough' }))
    await waitFor(() => {
      expect(mocks.cancelOutput).toHaveBeenCalledWith('ses_1', 'walkthrough', {
        source: { kind: 'session' },
      })
    })
  })

  it('refines a published separateSession output through the refine form', async () => {
    const user = userEvent.setup()
    mocks.getOutputState.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, { output: outputRecord('walkthrough') }),
    )
    renderPanel()

    const textarea = await screen.findByLabelText('Refine walkthrough')
    await user.type(textarea, 'tighten the introduction')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(mocks.refineOutput).toHaveBeenCalledWith('ses_1', {
        definitionId: 'walkthrough',
        params: { source: { kind: 'session' } },
        text: 'tighten the introduction',
      })
    })
  })

  it('updates a stale output via the stale banner button', async () => {
    const user = userEvent.setup()
    mocks.getOutputState.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, { stale: true, currentInputHash: 'hash-2' }),
    )
    renderPanel()

    expect(
      await screen.findByText('Changes have been updated since this walkthrough was generated'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateOutput).toHaveBeenCalledWith('ses_1', {
        definitionId: 'walkthrough',
        params: { source: { kind: 'session' } },
      })
    })
  })

  it('switches the change source to staged and generates with it', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(screen.getByRole('combobox', { name: 'Changes' }))
    await user.click(await screen.findByRole('option', { name: 'Staged' }))

    await waitFor(() => {
      expect(mocks.getOutputState).toHaveBeenCalledWith('ses_1', 'walkthrough', {
        source: { kind: 'staged' },
      })
    })

    await user.click(screen.getByRole('button', { name: 'Generate walkthrough' }))

    await waitFor(() => {
      expect(mocks.generateOutput).toHaveBeenCalledWith('ses_1', {
        definitionId: 'walkthrough',
        params: { source: { kind: 'staged' } },
      })
    })
  })

  it('prompts for a pull request number and withholds generate until valid', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByRole('button', { name: 'Generate walkthrough' })
    await user.click(screen.getByRole('combobox', { name: 'Changes' }))
    await user.click(await screen.findByRole('option', { name: 'Pull request' }))

    const number = await screen.findByLabelText('Pull request number')
    await user.type(number, '0')
    await user.tab()

    expect(await screen.findByText('Enter a pull request number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeDisabled()
    expect(mocks.generateOutput).not.toHaveBeenCalled()

    await user.clear(number)
    await user.type(number, '12')
    await user.tab()

    await waitFor(() => {
      expect(mocks.getOutputState).toHaveBeenCalledWith('ses_1', 'walkthrough', {
        source: { kind: 'pullRequest', number: 12 },
      })
    })
    expect(screen.queryByText('Enter a pull request number')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
    })
  })

  it('shows the no-input empty state when hasInput is false', async () => {
    mocks.getOutputState.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, { hasInput: false }),
    )
    renderPanel({
      request: {
        sessionId: 'ses_1',
        definitionId: 'walkthrough',
        params: { source: { kind: 'staged' } },
      },
    })

    expect(await screen.findByText('No changes to walk through')).toBeInTheDocument()
  })

  it('renders a server-recorded generation failure and keeps generate enabled', async () => {
    mocks.getOutputState.mockResolvedValue(
      state(WALKTHROUGH_OUTPUT_DEFINITION, {
        output: outputRecord('walkthrough', {
          status: 'failed',
          publishedAt: null,
          outputDir: null,
          error: {
            message: 'The output session did not publish within 15 minutes',
            code: 'OUTPUT_TIMEOUT',
          },
        }),
        error: {
          message: 'The output session did not publish within 15 minutes',
          code: 'OUTPUT_TIMEOUT',
        },
      }),
    )
    renderPanel()

    expect(
      await screen.findByText('The output session did not publish within 15 minutes'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toBeEnabled()
  })

  it('shows no update control for a stale currentSession output', async () => {
    mocks.getOutputState.mockResolvedValue(
      state(SESSION_REPORT_DEFINITION, {
        stale: true,
        currentInputHash: 'hash-2',
        output: outputRecord('session-report'),
      }),
    )
    renderPanel({ definitionId: 'session-report' })

    expect(await screen.findByTitle('Session report')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update session report' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Update / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate session report' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Regenerate session report' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Stop generating session report' }),
    ).not.toBeInTheDocument()
    expect(mocks.generateOutput).not.toHaveBeenCalled()
  })
})
