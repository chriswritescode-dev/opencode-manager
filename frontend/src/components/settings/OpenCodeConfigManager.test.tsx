import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import type { OpenCodeConfig } from '@/api/types/settings'
import type { DirectoryUploadItem } from '@/lib/directoryUpload'

const {
  mockGetOpenCodeConfigs,
  mockUpdateOpenCodeConfig,
  mockGetOpenCodeImportStatus,
  mockListManagedSkills,
  mockListOpenCodeDirectoryFiles,
  mockReplaceOpenCodeConfigDirectory,
  mockGetUploadItemsFromDataTransfer,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfigs: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockGetOpenCodeImportStatus: vi.fn(),
  mockListManagedSkills: vi.fn(),
  mockListOpenCodeDirectoryFiles: vi.fn(),
  mockReplaceOpenCodeConfigDirectory: vi.fn(),
  mockGetUploadItemsFromDataTransfer: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfigs: mockGetOpenCodeConfigs,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    getOpenCodeImportStatus: mockGetOpenCodeImportStatus,
    listManagedSkills: mockListManagedSkills,
    listOpenCodeDirectoryFiles: mockListOpenCodeDirectoryFiles,
    syncOpenCodeImport: vi.fn(),
    replaceOpenCodeConfigDirectory: mockReplaceOpenCodeConfigDirectory,
  },
}))

vi.mock('@/lib/directoryUpload', () => ({
  DIRECTORY_INPUT_PROPS: { webkitdirectory: '', directory: '' },
  getUploadItemsFromDataTransfer: mockGetUploadItemsFromDataTransfer,
  getUploadItemsFromFileList: vi.fn(),
  openPicker: vi.fn(),
  readUploadItemsFromInput: vi.fn(),
  useDirectoryDropZone: (options: {
    shouldSkip?: (relativePath: string, isDirectory: boolean) => boolean
    onItems: (items: DirectoryUploadItem[]) => void | Promise<void>
  }) => ({
    dropZoneRef: { current: null },
    isDragging: false,
    dropHandlers: {
      onDragEnter: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: async (e: React.DragEvent) => {
        const items = await mockGetUploadItemsFromDataTransfer(e.dataTransfer)
        await options.onItems(items)
      },
    },
  }),
}))

const defaultConfig: OpenCodeConfig = {
  id: 1,
  name: 'default',
  isDefault: true,
  isValid: true,
  createdAt: 1,
  updatedAt: 1,
  content: {
    provider: {
      openai: {
        name: 'OpenAI',
        models: {
          'gpt-4o': { name: 'GPT-4o' },
        },
      },
    },
  },
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('OpenCodeConfigManager', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeConfigs.mockResolvedValue({ configs: [defaultConfig] })
    mockGetOpenCodeImportStatus.mockResolvedValue({})
    mockListManagedSkills.mockResolvedValue([])
    mockListOpenCodeDirectoryFiles.mockImplementation((kind: 'agents' | 'commands') => {
      if (kind === 'commands') return Promise.resolve([])
      return Promise.resolve([])
    })
    mockUpdateOpenCodeConfig.mockResolvedValue(defaultConfig)
  })

  it('shows uploaded command and agent directory files in settings', async () => {
    mockListOpenCodeDirectoryFiles.mockImplementation((kind: 'agents' | 'commands') => {
      if (kind === 'commands') return Promise.resolve([{ kind, name: 'deploy', relativePath: 'project/deploy.md' }])
      return Promise.resolve([{ kind, name: 'planner', relativePath: 'team/planner.md' }])
    })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('Commands')
    await vi.waitFor(() => {
      expect(screen.getAllByText('1 configured').length).toBeGreaterThanOrEqual(2)
    })

    await user.click(screen.getByRole('button', { name: /Commands/i }))
    expect(await screen.findByText('/deploy')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: project/deploy.md')).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    expect(await screen.findByText('planner')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: team/planner.md')).toBeInTheDocument()
  })

  it('optimistic delete saves without eager restart modal', async () => {
    mockUpdateOpenCodeConfig.mockResolvedValueOnce({ ...defaultConfig, restartRequired: true })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1)
    const [configName, payload] = mockUpdateOpenCodeConfig.mock.calls[0]
    expect(configName).toBe('default')
    expect(payload.content.provider.openai.models).not.toHaveProperty('gpt-4o')
  })

  it('rollback on failure', async () => {
    mockUpdateOpenCodeConfig.mockRejectedValueOnce(new Error('boom'))

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1)

    const { showToast } = await import('@/lib/toast')
    await vi.waitFor(() => {
      expect(showToast.error).toHaveBeenCalled()
    })

    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  })

  it('anchors the AGENTS.md card to the settings dialog scrollport', async () => {
    renderWithQuery(<OpenCodeConfigManager />)
    const header = await screen.findByRole('button', { name: /Global Agent Instructions/i })
    const card = header.parentElement
    expect(card?.className).toContain('overflow-clip')
    expect(card?.className).not.toContain('overflow-hidden')
  })

  it('keeps the editor mounted while the post-save config refresh is in flight', async () => {
    const configWithRaw: OpenCodeConfig = {
      ...defaultConfig,
      rawContent: '{\n  "theme": "system"\n}',
    }
    mockGetOpenCodeConfigs.mockResolvedValueOnce({ configs: [configWithRaw] })
    let resolveRefresh!: () => void
    mockGetOpenCodeConfigs.mockReturnValueOnce(
      new Promise<{ configs: OpenCodeConfig[] }>((resolve) => {
        resolveRefresh = () => resolve({ configs: [configWithRaw] })
      }),
    )
    mockUpdateOpenCodeConfig.mockResolvedValue(configWithRaw)

    const user = userEvent.setup()
    const { container } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    const editButton = editIcon.closest('button') as HTMLButtonElement
    await user.click(editButton)

    const textarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: configWithRaw.rawContent! + ' ' } })
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Edit Config: default')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    resolveRefresh()
    await waitFor(() => expect(screen.queryByText('Edit Config: default')).not.toBeInTheDocument())
  })

  it('refetches the imperative config list after a config-directory replace', async () => {
    const user = userEvent.setup()
    mockReplaceOpenCodeConfigDirectory.mockResolvedValue({
      configSourceFilename: 'opencode.json',
      filesInstalled: ['opencode.json'],
      skippedPaths: [],
      preservedEntries: [],
      executablesRestored: [],
    })
    mockGetUploadItemsFromDataTransfer.mockResolvedValue([
      { file: new File(['{}'], 'opencode.json'), relativePath: 'opencode/opencode.json' },
    ])

    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    expect(mockGetOpenCodeConfigs).toHaveBeenCalledTimes(1)

    fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })
    await screen.findByText('Replace OpenCode Config Directory?')
    await user.click(screen.getByRole('button', { name: 'Replace and Restart' }))

    await waitFor(() => expect(mockReplaceOpenCodeConfigDirectory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockGetOpenCodeConfigs).toHaveBeenCalledTimes(2))
  })
})
