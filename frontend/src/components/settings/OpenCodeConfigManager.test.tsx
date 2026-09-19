import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import type { OpenCodeConfigFile } from '@/api/types/settings'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

const {
  mockGetOpenCodeConfig,
  mockUpdateOpenCodeConfig,
  mockRestartOpenCodeServer,
  mockGetActiveOpenCodeSessions,
  mockGetOpenCodeImportStatus,
  mockListManagedSkills,
  mockListOpenCodeDirectoryFiles,
  healthState,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockRestartOpenCodeServer: vi.fn(),
  mockGetActiveOpenCodeSessions: vi.fn(),
  mockGetOpenCodeImportStatus: vi.fn(),
  mockListManagedSkills: vi.fn(),
  mockListOpenCodeDirectoryFiles: vi.fn(),
  healthState: { data: { opencode: 'healthy', opencodeRestartPending: false } as Record<string, unknown> },
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => healthState,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    restartOpenCodeServer: mockRestartOpenCodeServer,
    getActiveOpenCodeSessions: mockGetActiveOpenCodeSessions,
    getOpenCodeImportStatus: mockGetOpenCodeImportStatus,
    listManagedSkills: mockListManagedSkills,
    listOpenCodeDirectoryFiles: mockListOpenCodeDirectoryFiles,
    syncOpenCodeImport: vi.fn(),
    upgradeOpenCode: vi.fn(),
  },
}))

const defaultContent = {
  provider: {
    openai: {
      name: 'OpenAI',
      models: {
        'gpt-4o': { name: 'GPT-4o' },
      },
    },
  },
}

const defaultConfig = makeOpenCodeConfigFile({
  path: '/workspace/.opencode/opencode.json',
  rawContent: JSON.stringify(defaultContent, null, 2),
  content: defaultContent,
})

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return { ...result, queryClient }
}

describe('OpenCodeConfigManager', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    healthState.data = { opencode: 'healthy', opencodeRestartPending: false }
    mockGetOpenCodeConfig.mockResolvedValue(defaultConfig)
    mockGetOpenCodeImportStatus.mockResolvedValue({})
    mockListManagedSkills.mockResolvedValue([])
    mockListOpenCodeDirectoryFiles.mockImplementation((kind: 'agents' | 'commands') => {
      if (kind === 'commands') return Promise.resolve([])
      return Promise.resolve([])
    })
    mockUpdateOpenCodeConfig.mockResolvedValue(defaultConfig)
    mockRestartOpenCodeServer.mockResolvedValue({ success: true, message: 'ok' })
    mockGetActiveOpenCodeSessions.mockResolvedValue({ count: 2, sessions: [] })
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
    const [payload] = mockUpdateOpenCodeConfig.mock.calls[0]
    expect(payload.content.provider.openai.models).not.toHaveProperty('gpt-4o')

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('deferred restart banner triggers server restart', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    const restartNowButton = await screen.findByRole('button', { name: /restart now/i })
    await user.click(restartNowButton)

    await screen.findByText('Restart OpenCode Server?')
    await user.click(screen.getByRole('button', { name: /restart now/i }))

    expect(mockRestartOpenCodeServer).toHaveBeenCalledTimes(1)
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

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('anchors the AGENTS.md card to the settings dialog scrollport', async () => {
    renderWithQuery(<OpenCodeConfigManager />)
    const header = await screen.findByRole('button', { name: /Global Agent Instructions/i })
    const card = header.parentElement
    expect(card?.className).toContain('overflow-clip')
    expect(card?.className).not.toContain('overflow-hidden')
  })

  it('keeps the editor mounted while the post-save config refresh is in flight', async () => {
    const configWithRaw: OpenCodeConfigFile = {
      ...defaultConfig,
      rawContent: '{\n  "theme": "system"\n}',
    }
    mockGetOpenCodeConfig.mockResolvedValueOnce(configWithRaw)
    let resolveRefresh!: () => void
    mockGetOpenCodeConfig.mockReturnValueOnce(
      new Promise<OpenCodeConfigFile>((resolve) => {
        resolveRefresh = () => resolve(configWithRaw)
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
    fireEvent.change(textarea, { target: { value: configWithRaw.rawContent + ' ' } })
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Edit opencode.json')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    resolveRefresh()
    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())
  })

  it('preserves an open draft when the config query refreshes in the background', async () => {
    const user = userEvent.setup()
    const { container, queryClient } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    const editButton = editIcon.closest('button') as HTMLButtonElement
    await user.click(editButton)

    const textarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    const draft = `${defaultConfig.rawContent}\n// draft\n`
    fireEvent.change(textarea, { target: { value: draft } })

    const refreshedContent = { theme: 'dark' }
    const refreshedConfig: OpenCodeConfigFile = {
      ...defaultConfig,
      content: refreshedContent,
      rawContent: JSON.stringify(refreshedContent, null, 2),
      updatedAt: 2,
    }
    mockGetOpenCodeConfig.mockResolvedValue(refreshedConfig)

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opencode-config', 'file'] })
    })

    await waitFor(() => {
      expect(screen.getByText(`Updated: ${new Date(2).toLocaleString()}`)).toBeInTheDocument()
    })
    expect(mockGetOpenCodeConfig).toHaveBeenCalledTimes(2)
    expect(textarea).toHaveValue(draft)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(textarea).toHaveValue(draft)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())

    const reopenIcon = container.querySelector('.lucide-square-pen') as SVGElement
    const reopenButton = reopenIcon.closest('button') as HTMLButtonElement
    await user.click(reopenButton)

    const reopenedTextarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    expect(reopenedTextarea).toHaveValue(JSON.stringify(refreshedContent, null, 2))
  })

  it('does not reset an in-flight save when the config query refreshes in the background', async () => {
    const user = userEvent.setup()
    const { container, queryClient } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    await user.click(editIcon.closest('button') as HTMLButtonElement)

    const textarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    const draft = `${defaultConfig.rawContent}\n// draft\n`
    fireEvent.change(textarea, { target: { value: draft } })

    let resolveSave!: (value: OpenCodeConfigFile) => void
    mockUpdateOpenCodeConfig.mockReturnValueOnce(
      new Promise<OpenCodeConfigFile>((resolve) => {
        resolveSave = resolve
      }),
    )

    const updateButton = screen.getByRole('button', { name: 'Update' })
    await user.click(updateButton)
    await waitFor(() => expect(updateButton).toBeDisabled())

    const refreshedContent = { theme: 'dark' }
    const refreshedConfig: OpenCodeConfigFile = {
      ...defaultConfig,
      content: refreshedContent,
      rawContent: JSON.stringify(refreshedContent, null, 2),
      updatedAt: 2,
    }
    mockGetOpenCodeConfig.mockResolvedValue(refreshedConfig)

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opencode-config', 'file'] })
    })

    await waitFor(() => {
      expect(screen.getByText(`Updated: ${new Date(2).toLocaleString()}`)).toBeInTheDocument()
    })
    expect(updateButton).toBeDisabled()
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveValue(draft)

    resolveSave(refreshedConfig)
    await waitFor(() => expect(screen.queryByText('Edit opencode.json')).not.toBeInTheDocument())
  })

  it('renders host import collapsed after the configuration card until expanded', async () => {
    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    const importToggle = await screen.findByRole('button', { name: /Existing OpenCode Host Import/i })
    expect(importToggle).toHaveAttribute('aria-expanded', 'false')
    const importContent = document.getElementById(importToggle.getAttribute('aria-controls') ?? '')
    expect(importContent).toHaveClass('hidden')

    const configTitle = screen.getByText('OpenCode Configuration')
    expect(configTitle.compareDocumentPosition(importToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(importToggle)
    expect(importToggle).toHaveAttribute('aria-expanded', 'true')
    expect(importContent).toHaveClass('block')
    expect(await screen.findByRole('button', { name: /Import From Host/i })).toBeInTheDocument()
  })

  it('shows the config file path and an invalid badge when the file is invalid', async () => {
    mockGetOpenCodeConfig.mockResolvedValue({
      ...defaultConfig,
      isValid: false,
      validationIssues: [{ path: 'model', message: 'Expected string' }],
    })

    renderWithQuery(<OpenCodeConfigManager />)

    expect(await screen.findByText('/workspace/.opencode/opencode.json')).toBeInTheDocument()
    expect(screen.getByText('Invalid Config')).toBeInTheDocument()
    expect(screen.getByText('model')).toBeInTheDocument()
  })
})
