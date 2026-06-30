import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import type { OpenCodeConfig } from '@/api/types/settings'

const {
  mockGetOpenCodeConfigs,
  mockUpdateOpenCodeConfig,
  mockRestartOpenCodeServer,
  mockGetActiveOpenCodeSessions,
  mockGetOpenCodeImportStatus,
  mockListManagedSkills,
  mockListOpenCodeDirectoryFiles,
  healthState,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfigs: vi.fn(),
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
    getOpenCodeConfigs: mockGetOpenCodeConfigs,
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
    healthState.data = { opencode: 'healthy', opencodeRestartPending: false }
    mockGetOpenCodeConfigs.mockResolvedValue({ configs: [defaultConfig] })
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
    renderWithQuery(<OpenCodeConfigManager hideHealthStatus />)

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
    renderWithQuery(<OpenCodeConfigManager hideHealthStatus />)

    await screen.findByText('GPT-4o')

    await user.click(screen.getByRole('button', { name: /Models/i }))

    await user.click(screen.getByLabelText('Actions for GPT-4o'))
    await user.click(screen.getByText('Delete'))

    expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1)
    const [configName, payload] = mockUpdateOpenCodeConfig.mock.calls[0]
    expect(configName).toBe('default')
    expect(payload.content.provider.openai.models).not.toHaveProperty('gpt-4o')

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('deferred restart banner triggers server restart', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager hideHealthStatus />)

    const restartNowButton = await screen.findByRole('button', { name: /restart now/i })
    await user.click(restartNowButton)

    await screen.findByText('Restart OpenCode Server?')
    await user.click(screen.getByRole('button', { name: /restart now/i }))

    expect(mockRestartOpenCodeServer).toHaveBeenCalledTimes(1)
  })

  it('rollback on failure', async () => {
    mockUpdateOpenCodeConfig.mockRejectedValueOnce(new Error('boom'))

    const user = userEvent.setup()
    renderWithQuery(<OpenCodeConfigManager hideHealthStatus />)

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
})
