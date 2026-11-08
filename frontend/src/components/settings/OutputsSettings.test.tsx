import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { OutputDefinition } from '@opencode-manager/shared/schemas'
import { OutputsSettings } from './OutputsSettings'
import { useSettings } from '@/hooks/useSettings'
import type { UserPreferences } from '@/api/types/settings'
import type { Provider } from '@/api/providers'
import { createUseSettingsMock } from '@/test/test-utils'

vi.mock('@/hooks/useSettings')

const mocks = vi.hoisted(() => ({
  listOutputDefinitions: vi.fn(),
  createOutputDefinition: vi.fn(),
  putOutputDefinition: vi.fn(),
  deleteOutputDefinition: vi.fn(),
  saveFile: vi.fn(),
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
}))

vi.mock('@/api/outputDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/outputDefinitions')>()
  return {
    ...actual,
    listOutputDefinitions: mocks.listOutputDefinitions,
    createOutputDefinition: mocks.createOutputDefinition,
    putOutputDefinition: mocks.putOutputDefinition,
    deleteOutputDefinition: mocks.deleteOutputDefinition,
  }
})

vi.mock('@/lib/download', () => ({ saveFile: mocks.saveFile }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: mocks.useProviders }))
vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
}))

const providers: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      {
        id: 'claude-sonnet-4',
        modelID: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        released: 0,
        free: false,
      },
    ],
  },
]

const basePreferences: UserPreferences = {
  theme: 'dark',
  mode: 'build',
  autoScroll: true,
  expandDiffs: true,
  expandToolCalls: false,
  showReasoning: false,
  simpleChatMode: false,
  keyboardShortcuts: {},
  customCommands: [],
}

const GLOBAL_DEFINITION: OutputDefinition = {
  id: 'summary',
  label: 'Summary',
  description: 'A summary of the session.',
  icon: 'FileText',
  params: [],
  instructions: 'Summarize the session.',
  dataSchema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
  },
  renderer: { kind: 'template', html: '<p>{{summary}}</p>' },
  generation: 'separateSession',
  origin: 'global',
}

const BUILTIN_DEFINITION: OutputDefinition = {
  id: 'builtin-output',
  label: 'Builtin output',
  description: 'A builtin definition.',
  icon: 'Sparkles',
  params: [],
  instructions: 'Build the builtin output.',
  renderer: { kind: 'builtin', id: 'walkthrough' },
  generation: 'separateSession',
  origin: 'builtin',
}

const SESSION_DEFINITION: OutputDefinition = {
  id: 'session-output',
  label: 'Session output',
  description: 'A session-only definition.',
  icon: 'ClipboardList',
  params: [],
  instructions: 'Build the session output.',
  renderer: { kind: 'html' },
  generation: 'currentSession',
  origin: 'session',
}

const IMPORT_INPUT = {
  id: 'imported-output',
  label: 'Imported output',
  description: 'From a file.',
  icon: 'FileText' as const,
  params: [],
  instructions: 'Build the imported output.',
  dataSchema: {
    type: 'object' as const,
    properties: { summary: { type: 'string' as const } },
    required: ['summary'],
  },
  renderer: { kind: 'template' as const, html: '<p>{{summary}}</p>' },
  generation: 'separateSession' as const,
}

function renderOutputs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<OutputsSettings />, { wrapper })
}

function mockUseSettings(overrides: Partial<ReturnType<typeof useSettings>> = {}) {
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({ preferences: basePreferences, ...overrides }),
  )
}

describe('OutputsSettings', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    if (typeof Blob.prototype.text !== 'function') {
      Blob.prototype.text = function text(this: Blob) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsText(this)
        })
      }
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listOutputDefinitions.mockResolvedValue([
      GLOBAL_DEFINITION,
      BUILTIN_DEFINITION,
      SESSION_DEFINITION,
    ])
    mocks.createOutputDefinition.mockImplementation(async (input) => ({ ...input, origin: 'global' }))
    mocks.putOutputDefinition.mockImplementation(async (id, input) => ({ ...input, id, origin: 'global' }))
    mocks.deleteOutputDefinition.mockResolvedValue(undefined)
    mocks.saveFile.mockResolvedValue(true)
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] } })
    mocks.useOpenCodeModelState.mockReturnValue({ data: { favorite: [], recent: [], variant: {} } })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: null })
  })

  it('saves the chosen model as the output model after the debounce', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({ updateSettings })
      renderOutputs()

      fireEvent.focus(screen.getByLabelText('Output model'))
      fireEvent.click(screen.getByRole('option', { name: /Claude Sonnet 4/ }))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({ outputModel: 'anthropic/claude-sonnet-4' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the output model to an empty string', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, outputModel: 'anthropic/claude-sonnet-4' },
        updateSettings,
      })
      renderOutputs()

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({ outputModel: '' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not save an unchanged output model', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, outputModel: 'anthropic/claude-sonnet-4' },
        updateSettings,
      })
      renderOutputs()

      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the legacy stored model when no output model is set', () => {
    const legacyPreferences = {
      ...basePreferences,
      ['walkthrough' + 'Model']: 'legacy-provider/legacy-model',
    } as UserPreferences
    mockUseSettings({ preferences: legacyPreferences })
    renderOutputs()

    expect(screen.getByLabelText('Output model')).toHaveValue('legacy-provider/legacy-model')
  })

  it('lists only global output definitions', async () => {
    mockUseSettings()
    renderOutputs()

    expect(await screen.findByText('Summary')).toBeInTheDocument()
    expect(screen.queryByText('Builtin output')).not.toBeInTheDocument()
    expect(screen.queryByText('Session output')).not.toBeInTheDocument()
  })

  it('creates an output definition with the template renderer from the editor', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    renderOutputs()

    await user.click(screen.getByRole('button', { name: 'New' }))

    const definitionJson = screen.getByLabelText('Definition JSON')
    fireEvent.change(definitionJson, {
      target: {
        value: JSON.stringify(
          {
            ...IMPORT_INPUT,
            id: 'new-output',
            label: 'New output',
            renderer: { kind: 'template' },
          },
          null,
          2,
        ),
      },
    })
    fireEvent.change(screen.getByLabelText('Template HTML'), {
      target: { value: '<section>New</section>' },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocks.createOutputDefinition).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-output',
          renderer: { kind: 'template', html: '<section>New</section>' },
        }),
      )
    })
  })

  it('updates a global definition with its id and the merged renderer', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    renderOutputs()

    await screen.findByText('Summary')
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const definitionJson = screen.getByLabelText('Definition JSON')
    const parsed = JSON.parse((definitionJson as HTMLTextAreaElement).value)
    fireEvent.change(definitionJson, {
      target: { value: JSON.stringify({ ...parsed, id: 'renamed-output' }, null, 2) },
    })
    fireEvent.change(screen.getByLabelText('Template HTML'), {
      target: { value: '<section>Updated</section>' },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocks.putOutputDefinition).toHaveBeenCalledWith(
        'summary',
        expect.objectContaining({
          id: 'summary',
          renderer: { kind: 'template', html: '<section>Updated</section>' },
        }),
      )
    })
  })

  it('deletes a global definition after confirmation', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    renderOutputs()

    await screen.findByText('Summary')
    await user.click(screen.getByLabelText('Actions for Summary'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocks.deleteOutputDefinition).toHaveBeenCalledWith('summary')
    })
  })

  it('exports global definitions without their origin', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    renderOutputs()

    await screen.findByText('Summary')
    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(mocks.saveFile).toHaveBeenCalledTimes(1)
    const [blob, filename] = mocks.saveFile.mock.calls[0]
    expect(filename).toBe('output-definitions.json')

    const text = await (blob as Blob).text()
    const exported = JSON.parse(text) as Record<string, unknown>[]
    expect(exported).toHaveLength(1)
    expect(exported[0]).toMatchObject({ id: 'summary', label: 'Summary' })
    expect(exported[0]).not.toHaveProperty('origin')
  })

  it('round-trips exported definitions through import', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    const { container } = renderOutputs()

    await screen.findByText('Summary')
    await user.click(screen.getByRole('button', { name: 'Export' }))

    const exportedText = await (mocks.saveFile.mock.calls[0][0] as Blob).text()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([exportedText], 'output-definitions.json', {
      type: 'application/json',
    })

    fireEvent.change(input, { target: { files: [file] } })

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(mocks.putOutputDefinition).toHaveBeenCalledWith(
        'summary',
        expect.objectContaining({ id: 'summary', renderer: GLOBAL_DEFINITION.renderer }),
      )
    })
  })

  it('imports a valid file by upserting each definition', async () => {
    mockUseSettings()
    const { container } = renderOutputs()

    await screen.findByText('Summary')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify([IMPORT_INPUT])], 'output-definitions.json', {
      type: 'application/json',
    })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.putOutputDefinition).toHaveBeenCalledWith(
        'imported-output',
        expect.objectContaining({ id: 'imported-output' }),
      )
    })
    expect(mocks.putOutputDefinition).toHaveBeenCalledTimes(1)
  })

  it('asks before replacing an existing definition on import', async () => {
    const user = userEvent.setup()
    mockUseSettings()
    const { container } = renderOutputs()

    await screen.findByText('Summary')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const replacement = { ...IMPORT_INPUT, id: 'summary', label: 'Replaced summary' }
    const file = new File([JSON.stringify([replacement])], 'output-definitions.json', {
      type: 'application/json',
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('Replace existing output definitions?')).toBeInTheDocument()
    expect(mocks.putOutputDefinition).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(mocks.putOutputDefinition).toHaveBeenCalledWith(
        'summary',
        expect.objectContaining({ id: 'summary', label: 'Replaced summary' }),
      )
    })
  })

  it('shows an inline error when the imported file is not valid JSON', async () => {
    mockUseSettings()
    const { container } = renderOutputs()

    await screen.findByText('Summary')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['{ not json'], 'output-definitions.json', {
      type: 'application/json',
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON')
    expect(mocks.putOutputDefinition).not.toHaveBeenCalled()
  })
})
