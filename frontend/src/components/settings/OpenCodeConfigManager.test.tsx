import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import { FetchError } from '@/api/fetchWrapper'
import type { OpenCodeConfigFile } from '@/api/types/settings'
import { makeOpenCodeConfigFile, makeOpenCodeConfigSource } from '@/test/fixtures/opencode-config'

const {
  mockGetOpenCodeConfig,
  mockUpdateOpenCodeConfig,
  mockGetManagedOpenCodeConfig,
  mockPatchOpenCodeConfig,
  mockRestartOpenCodeServer,
  mockGetActiveOpenCodeSessions,
  mockGetOpenCodeImportStatus,
  mockListManagedSkills,
  mockListOpenCodeDirectoryFiles,
  mockGetAgentsMd,
  healthState,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockGetManagedOpenCodeConfig: vi.fn(),
  mockPatchOpenCodeConfig: vi.fn(),
  mockRestartOpenCodeServer: vi.fn(),
  mockGetActiveOpenCodeSessions: vi.fn(),
  mockGetOpenCodeImportStatus: vi.fn(),
  mockListManagedSkills: vi.fn(),
  mockListOpenCodeDirectoryFiles: vi.fn(),
  mockGetAgentsMd: vi.fn(),
  healthState: { data: { opencode: 'healthy', opencodeRestartPending: false } as Record<string, unknown> },
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => healthState,
}))

vi.mock('@/hooks/useMcpServers', () => ({
  useMcpServers: () => ({
    status: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    connect: vi.fn(),
    connectAsync: vi.fn(),
    isConnecting: false,
    disconnect: vi.fn(),
    disconnectAsync: vi.fn(),
    isDisconnecting: false,
    startAuth: vi.fn(),
    startAuthAsync: vi.fn(),
    isStartingAuth: false,
    completeAuth: vi.fn(),
    completeAuthAsync: vi.fn(),
    isCompletingAuth: false,
    removeAuth: vi.fn(),
    removeAuthAsync: vi.fn(),
    isRemovingAuth: false,
  }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    getManagedOpenCodeConfig: mockGetManagedOpenCodeConfig,
    patchOpenCodeConfig: mockPatchOpenCodeConfig,
    restartOpenCodeServer: mockRestartOpenCodeServer,
    getActiveOpenCodeSessions: mockGetActiveOpenCodeSessions,
    getOpenCodeImportStatus: mockGetOpenCodeImportStatus,
    listManagedSkills: mockListManagedSkills,
    listOpenCodeDirectoryFiles: mockListOpenCodeDirectoryFiles,
    getAgentsMd: mockGetAgentsMd,
    discoverOpenCodeModels: vi.fn().mockResolvedValue({ models: [], cached: false }),
    syncOpenCodeImport: vi.fn(),
    upgradeOpenCode: vi.fn(),
  },
}))

vi.mock('@/components/model/ModelCombobox', () => ({ ModelCombobox: () => null }))

vi.mock('./AgentDialog', () => ({
  AgentDialog: ({ open, onSubmit, editingAgent }: {
    open: boolean
    onSubmit: (name: string, agent: Record<string, unknown>) => void
    editingAgent?: { name: string } | null
  }) => open ? (
    <div>
      <button onClick={() => onSubmit(editingAgent?.name ?? 'new-agent', { system: 'Updated', mode: 'subagent' })}>
        Submit Agent
      </button>
      <button onClick={() => onSubmit('renamed-agent', { system: 'Renamed', mode: 'subagent' })}>
        Submit Renamed Agent
      </button>
    </div>
  ) : null,
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

const defaultManagedInfo = {
  providers: {
    openai: {
      name: 'OpenAI',
      models: {
        'gpt-4o': { name: 'GPT-4o', modelID: 'gpt-4o' },
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
    mockGetManagedOpenCodeConfig.mockResolvedValue({ info: defaultManagedInfo })
    mockPatchOpenCodeConfig.mockResolvedValue({ ...defaultConfig, revision: 'rev-2' })
    mockGetOpenCodeImportStatus.mockResolvedValue({})
    mockGetAgentsMd.mockResolvedValue({ content: '# Agent Instructions' })
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
    expect(await screen.findByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: project/deploy.md')).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    expect(await screen.findByText('planner')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: team/planner.md')).toBeInTheDocument()
  })

  it('optimistic delete saves without eager restart modal', async () => {
    mockPatchOpenCodeConfig.mockResolvedValueOnce({ ...defaultConfig, restartRequired: true })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(1)
    const [payload] = mockPatchOpenCodeConfig.mock.calls[0]
    expect(payload.patch.providers.openai.models).toEqual({ 'gpt-4o': null })

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
    mockPatchOpenCodeConfig.mockRejectedValueOnce(new Error('boom'))

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(1)

    const { showToast } = await import('@/lib/toast')
    await vi.waitFor(() => {
      expect(showToast.error).toHaveBeenCalled()
    })

    expect(screen.getByText('GPT-4o')).toBeInTheDocument()

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('keeps the AGENTS.md editor mounted while its disclosure toggles', async () => {
    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    const header = await screen.findByRole('button', { name: /Global Agent Instructions/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    const content = document.getElementById(header.getAttribute('aria-controls') ?? '')
    expect(content).toHaveClass('hidden')
    expect(await screen.findByLabelText('AGENTS.md content')).toBeInTheDocument()

    const chevron = header.querySelector('.lucide-chevron-down')
    expect(chevron).not.toHaveClass('rotate-180')

    await user.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(content).toHaveClass('block')
    expect(chevron).toHaveClass('rotate-180')
    expect(chevron).not.toHaveClass('rotate-90')
    expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument()

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveClass('hidden')
    expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument()
  })

  it('wires every disclosure header to a unique content id', async () => {
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    const headers = screen.getAllByRole('button').filter(
      (button) => button.hasAttribute('aria-controls') && !button.hasAttribute('aria-haspopup'),
    )
    expect(headers).toHaveLength(7)
    headers.forEach((header) => expect(header).toHaveAttribute('aria-expanded'))

    const contentIds = headers.map((header) => header.getAttribute('aria-controls') ?? '')
    expect(new Set(contentIds).size).toBe(7)
    contentIds.forEach((id) => expect(document.getElementById(id)).toBeInTheDocument())
  })

  it('labels the config file actions and exposes its metadata', async () => {
    renderWithQuery(<OpenCodeConfigManager />)

    expect(await screen.findByText('opencode.json')).toBeInTheDocument()
    const editButton = screen.getAllByRole('button', { name: 'Edit' }).find((button) => button.querySelector('.lucide-square-pen'))
    expect(editButton).toBeDefined()
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByText('File location and updated time')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.opencode/opencode.json')).toBeInTheDocument()
    expect(screen.getByText(`Updated: ${new Date(defaultConfig.updatedAt).toLocaleString()}`)).toBeInTheDocument()
  })

  it('sends the source and expected revision and replaces the cache with the returned snapshot for a raw save', async () => {
    const configWithRaw: OpenCodeConfigFile = {
      ...defaultConfig,
      rawContent: '{\n  "theme": "system"\n}',
    }
    mockGetOpenCodeConfig.mockResolvedValueOnce(configWithRaw)
    const savedConfig: OpenCodeConfigFile = {
      ...configWithRaw,
      rawContent: '{\n  "theme": "dark"\n}',
      revision: 'rev-2',
      updatedAt: 2,
    }
    mockUpdateOpenCodeConfig.mockResolvedValue(savedConfig)

    const user = userEvent.setup()
    const { container, queryClient } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    const editButton = editIcon.closest('button') as HTMLButtonElement
    await user.click(editButton)
    const managedReadsBeforeSave = mockGetManagedOpenCodeConfig.mock.calls.length

    const textarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    const next = configWithRaw.rawContent + ' '
    fireEvent.change(textarea, { target: { value: next } })
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith({
        content: next,
        source: 'opencode.json',
        expectedRevision: 'rev-1',
      })
    })
    const cached = queryClient.getQueryData<OpenCodeConfigFile>(['opencode-config', 'file'])
    expect(cached?.revision).toBe('rev-2')
    expect(cached?.rawContent).toBe('{\n  "theme": "dark"\n}')
    await waitFor(() => expect(mockGetManagedOpenCodeConfig.mock.calls.length).toBeGreaterThan(managedReadsBeforeSave))
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
    const refreshedRaw = JSON.stringify(refreshedContent, null, 2)
    const refreshedConfig: OpenCodeConfigFile = {
      ...defaultConfig,
      content: refreshedContent,
      rawContent: refreshedRaw,
      sources: [
        makeOpenCodeConfigSource({
          name: 'opencode.json',
          path: defaultConfig.path,
          rawContent: refreshedRaw,
          content: refreshedContent,
          updatedAt: 2,
        }),
      ],
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
    expect(reopenedTextarea).toHaveValue(refreshedRaw)
  })

  it('sends the expected revision for structured updates', async () => {
    mockPatchOpenCodeConfig.mockResolvedValueOnce({ ...defaultConfig, restartRequired: true })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(1))
    const [payload] = mockPatchOpenCodeConfig.mock.calls[0]
    expect(payload.expectedRevision).toBe('rev-1')
    expect(payload.source).toBeUndefined()
    expect(payload.patch.providers.openai.models).toEqual({ 'gpt-4o': null })
  })

  it('resolves the add-server expected revision from the query cache', async () => {
    const cachedConfig = { ...defaultConfig, revision: 'rev-A' }
    mockGetOpenCodeConfig.mockResolvedValue(cachedConfig)
    mockPatchOpenCodeConfig.mockResolvedValue({ ...cachedConfig, restartRequired: true })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    await user.click(screen.getByRole('button', { name: /Add Server/i }))

    await user.type(await screen.findByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(1))
    const [payload] = mockPatchOpenCodeConfig.mock.calls[0]
    expect(payload.expectedRevision).toBe('rev-A')
    expect(payload.patch.mcp.servers.filesystem).toEqual(expect.objectContaining({
      type: 'local',
      command: ['npx', 'server-filesystem', '/tmp'],
    }))
  })

  it('deletes a configured MCP server through an mcp.servers patch', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: { mcp: { servers: { filesystem: { type: 'local', command: ['npx', 'server'] } } } },
    })
    mockPatchOpenCodeConfig.mockResolvedValue({ ...defaultConfig, revision: 'rev-2' })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /MCP Servers/i }))
    await user.click(await screen.findByLabelText('Actions for Filesystem'))
    await user.click(screen.getByText('Delete Server'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: { mcp: { servers: { filesystem: null } } },
      expectedRevision: 'rev-1',
    }))
  })

  it('sends the revision from the previous save on the next structured save', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: {
        providers: {
          openai: {
            name: 'OpenAI',
            models: {
              'gpt-4o': { name: 'GPT-4o' },
              'gpt-3.5': { name: 'GPT-3.5' },
            },
          },
        },
      },
    })
    const afterFirstDelete = { ...defaultConfig, revision: 'rev-2' }
    const afterSecondDelete = { ...defaultConfig, revision: 'rev-3' }
    mockPatchOpenCodeConfig
      .mockResolvedValueOnce(afterFirstDelete)
      .mockResolvedValueOnce(afterSecondDelete)

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))
    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(1))
    expect(mockPatchOpenCodeConfig.mock.calls[0][0].expectedRevision).toBe('rev-1')

    await user.click(screen.getByLabelText('Actions for GPT-3.5'))
    await user.click(screen.getByText('Delete'))
    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledTimes(2))
    expect(mockPatchOpenCodeConfig.mock.calls[1][0].expectedRevision).toBe('rev-2')
  })

  it('adds a model to a new API provider through a providers patch', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({ info: {} })
    mockPatchOpenCodeConfig.mockResolvedValue({ ...defaultConfig, revision: 'rev-2' })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Models/i }))
    await user.click(screen.getByRole('button', { name: /Add Model/i }))

    fireEvent.change(await screen.findByPlaceholderText('e.g., my-provider'), { target: { value: 'my-provider' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., My Provider'), { target: { value: 'My Provider' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), { target: { value: 'https://api.example.com/v1' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., qwen-3.5-27b'), { target: { value: 'gpt-5' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., MiniMax-M2.7'), { target: { value: 'gpt-5-model' } })
    fireEvent.change(screen.getByPlaceholderText('e.g., Qwen3.5-27B'), { target: { value: 'GPT-5' } })

    const createButton = screen.getByRole('button', { name: /create/i })
    await waitFor(() => expect(createButton).not.toBeDisabled())
    await user.click(createButton)

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: {
        providers: {
          'my-provider': {
            name: 'My Provider',
            settings: { baseURL: 'https://api.example.com/v1' },
            models: {
              'gpt-5': expect.objectContaining({ modelID: 'gpt-5-model', name: 'GPT-5' }),
            },
          },
        },
      },
      expectedRevision: 'rev-1',
    }))
  })

  it('saves an edited model under providers when the managed response converted a v1 entry', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: {
        providers: {
          openai: {
            name: 'OpenAI',
            models: { 'gpt-4o': { name: 'GPT-4o', modelID: 'gpt-4o' } },
          },
        },
      },
    })
    mockPatchOpenCodeConfig.mockResolvedValue({ ...defaultConfig, revision: 'rev-2' })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Models/i }))
    await user.click(await screen.findByText('GPT-4o'))

    fireEvent.change(await screen.findByPlaceholderText('e.g., Qwen3.5-27B'), { target: { value: 'GPT-4o Updated' } })
    await user.click(screen.getByRole('button', { name: /update/i }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: {
        providers: {
          openai: {
            name: 'OpenAI',
            models: {
              'gpt-4o': expect.objectContaining({ name: 'GPT-4o Updated', modelID: 'gpt-4o' }),
            },
          },
        },
      },
      expectedRevision: 'rev-1',
    }))
  })

  it('keeps a converted provider and its sibling models when deleting one model', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: {
        providers: {
          p: {
            name: 'Provider P',
            settings: { baseURL: 'http://x' },
            models: {
              a: { name: 'Model A' },
              b: { name: 'Model B' },
            },
          },
        },
      },
    })
    mockPatchOpenCodeConfig.mockResolvedValue({ ...defaultConfig, revision: 'rev-2' })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Models/i }))
    await user.click(await screen.findByLabelText('Actions for Model A'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: {
        providers: {
          p: {
            name: 'Provider P',
            settings: { baseURL: 'http://x' },
            models: {
              a: null,
              b: { name: 'Model B' },
            },
          },
        },
      },
      expectedRevision: 'rev-1',
    }))
  })

  it('reports a comment-only raw save as applied without a restart', async () => {
    const configWithRaw: OpenCodeConfigFile = {
      ...defaultConfig,
      rawContent: '{\n  // comment only\n  "theme": "system"\n}',
    }
    mockGetOpenCodeConfig.mockResolvedValue(configWithRaw)
    mockUpdateOpenCodeConfig.mockResolvedValue({ ...configWithRaw, restartRequired: false, revision: 'rev-2' })

    const user = userEvent.setup()
    const { container } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')
    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    await user.click(editIcon.closest('button') as HTMLButtonElement)

    const textarea = await screen.findByLabelText('Config content') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: configWithRaw.rawContent + '\n// another\n' } })
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const { showToast } = await import('@/lib/toast')
    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Configuration updated'))
    expect(showToast.success).not.toHaveBeenCalledWith('Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.')
  })

  it('asks for a restart after a semantic structured change', async () => {
    mockPatchOpenCodeConfig.mockResolvedValueOnce({ ...defaultConfig, restartRequired: true })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    const { showToast } = await import('@/lib/toast')
    await waitFor(() => {
      expect(showToast.success).toHaveBeenCalledWith('Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.')
    })
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

  it('renders host import collapsed after the configuration file until expanded', async () => {
    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    const importToggle = await screen.findByRole('button', { name: /Existing OpenCode Host Import/i })
    expect(importToggle).toHaveAttribute('aria-expanded', 'false')
    const importContent = document.getElementById(importToggle.getAttribute('aria-controls') ?? '')
    expect(importContent).toHaveClass('hidden')

    const configFileName = await screen.findByText('opencode.json')
    expect(configFileName.compareDocumentPosition(importToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(importToggle)
    expect(importToggle).toHaveAttribute('aria-expanded', 'true')
    expect(importContent).toHaveClass('block')
    expect(await screen.findByRole('button', { name: /Import From Host/i })).toBeInTheDocument()
  })

  it('warns that importing removes workspace config files absent on the host', async () => {
    mockGetOpenCodeImportStatus.mockResolvedValue({
      configSourcePath: '/import/opencode-config/opencode.jsonc',
      configSourcePaths: ['/import/opencode-config/opencode.json', '/import/opencode-config/opencode.jsonc'],
      stateSourcePath: null,
      workspaceConfigPath: '/workspace/.config/opencode/opencode.json',
      workspaceConfigPathsToRemove: ['/workspace/.config/opencode/opencode.jsonc'],
      workspaceStatePath: '/workspace/.opencode/state/opencode',
      workspaceStateExists: false,
    })

    renderWithQuery(<OpenCodeConfigManager />)

    expect(await screen.findByText(/These files will be removed: opencode.jsonc\./)).toBeInTheDocument()
    expect(screen.getByText(/Host files imported: opencode.json, opencode.jsonc\./)).toBeInTheDocument()
  })

  it('does not warn about removals when the host has every workspace config file', async () => {
    mockGetOpenCodeImportStatus.mockResolvedValue({
      configSourcePath: '/import/opencode-config/opencode.json',
      configSourcePaths: ['/import/opencode-config/opencode.json'],
      stateSourcePath: null,
      workspaceConfigPath: '/workspace/.config/opencode/opencode.json',
      workspaceConfigPathsToRemove: [],
      workspaceStatePath: '/workspace/.opencode/state/opencode',
      workspaceStateExists: false,
    })

    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    expect(screen.queryByText(/These files will be removed/)).not.toBeInTheDocument()
  })

  it('shows the config file name and an invalid badge when the file is invalid', async () => {
    mockGetOpenCodeConfig.mockResolvedValue({
      ...defaultConfig,
      isValid: false,
      validationIssues: [{ path: 'model', message: 'Expected string' }],
    })

    renderWithQuery(<OpenCodeConfigManager />)

    expect(await screen.findByText('opencode.json')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.opencode/opencode.json')).toBeInTheDocument()
    expect(screen.getByText('Invalid Config')).toBeInTheDocument()
    expect(screen.getByText('model')).toBeInTheDocument()
  })

  it('hides the multi-source notice when only one config file is present', async () => {
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    expect(screen.queryByText('Multiple configuration files are merged')).not.toBeInTheDocument()
  })

  it('lists merged config files in override order and names the structured write target', async () => {
    const multiSourceConfig = makeOpenCodeConfigFile({
      path: '/workspace/.config/opencode/opencode.jsonc',
      rawContent: '{}',
      sources: [
        makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json' }),
        makeOpenCodeConfigSource({ name: 'opencode.jsonc', path: '/workspace/.config/opencode/opencode.jsonc' }),
      ],
    })
    mockGetOpenCodeConfig.mockResolvedValue(multiSourceConfig)

    renderWithQuery(<OpenCodeConfigManager />)

    const notice = (await screen.findByText('Multiple configuration files are merged')).closest('[role="alert"]') as HTMLElement
    expect(notice).toBeInTheDocument()
    expect(notice).toHaveTextContent('opencode.json, opencode.jsonc')
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')
    expect(notice).toHaveTextContent('For simpler configuration, consolidate the settings you need into one file, then remove redundant files after verifying the result.')
  })

  it('lists agents and commands from the managed config query', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: {
        agents: { reviewer: { system: 'Review code', description: 'Reviews code', mode: 'subagent' } },
        commands: { deploy: { template: 'Deploy it', description: 'Deploys the app' } },
      },
    })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Commands/i }))
    expect(await screen.findByText('deploy')).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    expect(await screen.findByText('reviewer')).toBeInTheDocument()
  })

  it('shows the unavailable notice and keeps the raw editor reachable when OpenCode is down', async () => {
    mockGetManagedOpenCodeConfig.mockRejectedValue(new FetchError('OpenCode server unavailable', 503))

    const user = userEvent.setup()
    const { container } = renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Commands/i }))
    expect(await screen.findByText(/OpenCode is not running, so the configured commands cannot be listed/)).toBeInTheDocument()

    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    expect(await screen.findByText(/OpenCode is not running, so the configured agents cannot be listed/)).toBeInTheDocument()

    const editIcon = container.querySelector('.lucide-square-pen') as SVGElement
    await user.click(editIcon.closest('button') as HTMLButtonElement)
    expect(await screen.findByLabelText('Config content')).toBeInTheDocument()
  })

  it('shows an error notice instead of empty managed sections when the managed config request fails', async () => {
    mockGetManagedOpenCodeConfig.mockRejectedValue(new FetchError('Bad Gateway', 502))

    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    expect(await screen.findAllByText('OpenCode configuration unavailable')).toHaveLength(4)
    expect(screen.getAllByText('Bad Gateway')).toHaveLength(4)

    const commandsHeader = screen.getByRole('button', { name: /^Commands/ })
    expect(commandsHeader).toHaveTextContent('Unavailable')
    expect(commandsHeader).not.toHaveTextContent('0 configured')
    expect(screen.queryByText('No commands configured')).not.toBeInTheDocument()
    expect(screen.queryByText('No agents configured')).not.toBeInTheDocument()
    expect(screen.queryByText('No models configured')).not.toBeInTheDocument()
  })

  it('shows a loading state instead of empty managed sections while the managed config request is pending', async () => {
    mockGetManagedOpenCodeConfig.mockReturnValue(new Promise(() => {}))

    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    expect(await screen.findAllByText('Loading configuration...')).toHaveLength(4)
    expect(screen.getByRole('button', { name: /^Commands/ })).toHaveTextContent('Loading...')
    expect(screen.queryByText('No commands configured')).not.toBeInTheDocument()
  })

  it('saves an agent with an entity patch through the managed config endpoint', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: { agents: { reviewer: { system: 'Review code', mode: 'subagent' } } },
    })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    await user.click(await screen.findByText('reviewer'))
    await user.click(await screen.findByRole('button', { name: 'Submit Agent' }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: { agents: { reviewer: { system: 'Updated', mode: 'subagent' } } },
      expectedRevision: 'rev-1',
    }))
  })

  it('deletes the previous agent name in the same patch when renaming', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: { agents: { reviewer: { system: 'Review code', mode: 'subagent' } } },
    })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    const agentsButton = screen.getAllByRole('button', { name: /Agents/i }).find(button => button.textContent?.startsWith('Agents'))
    expect(agentsButton).toBeDefined()
    await user.click(agentsButton!)
    await user.click(await screen.findByText('reviewer'))
    await user.click(await screen.findByRole('button', { name: 'Submit Renamed Agent' }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: {
        agents: {
          'renamed-agent': { system: 'Renamed', mode: 'subagent' },
          reviewer: null,
        },
      },
      expectedRevision: 'rev-1',
    }))
  })

  it('sends null for cleared command fields and a disabled subagent', async () => {
    mockGetManagedOpenCodeConfig.mockResolvedValue({
      info: {
        commands: {
          review: {
            template: 'Review this code',
            description: 'Reviews changes',
            agent: 'reviewer',
            model: 'openai/gpt-5',
            subagent: true,
          },
        },
      },
    })

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager />)

    await screen.findByText('opencode.json')
    await user.click(screen.getByRole('button', { name: /Commands/i }))
    await user.click(await screen.findByText('review'))

    await user.clear(screen.getByLabelText('Description'))
    await user.clear(screen.getByLabelText('Agent (optional)'))
    await user.clear(screen.getByLabelText('Model (optional)'))
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => expect(mockPatchOpenCodeConfig).toHaveBeenCalledWith({
      patch: {
        commands: {
          review: {
            template: 'Review this code',
            description: null,
            agent: null,
            model: null,
            subagent: null,
          },
        },
      },
      expectedRevision: 'rev-1',
    }))
  })
})
