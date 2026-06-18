import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'
import type { OpenCodeConfig } from '@/api/types/settings'

const {
  mockGetOpenCodeConfigs,
  mockUpdateOpenCodeConfig,
  mockRestartOpenCodeServer,
  mockGetOpenCodeImportStatus,
  mockListManagedSkills,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfigs: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockRestartOpenCodeServer: vi.fn(),
  mockGetOpenCodeImportStatus: vi.fn(),
  mockListManagedSkills: vi.fn(),
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => ({ data: { opencode: 'healthy' } }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfigs: mockGetOpenCodeConfigs,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    restartOpenCodeServer: mockRestartOpenCodeServer,
    getOpenCodeImportStatus: mockGetOpenCodeImportStatus,
    listManagedSkills: mockListManagedSkills,
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
    mockGetOpenCodeConfigs.mockResolvedValue({ configs: [defaultConfig] })
    mockGetOpenCodeImportStatus.mockResolvedValue({})
    mockListManagedSkills.mockResolvedValue([])
    mockUpdateOpenCodeConfig.mockResolvedValue(defaultConfig)
    mockRestartOpenCodeServer.mockResolvedValue({ success: true, message: 'ok' })
  })

  it('optimistic delete + restart prompt', async () => {
    let resolveUpdate: (config: OpenCodeConfig) => void = () => {}
    mockUpdateOpenCodeConfig.mockImplementationOnce(() => new Promise<OpenCodeConfig>((resolve) => {
      resolveUpdate = resolve
    }))

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

    await screen.findByText('Restart OpenCode Server?')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()

    await act(async () => {
      resolveUpdate(defaultConfig)
    })

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /restart now/i })).not.toBeDisabled()
    })

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
