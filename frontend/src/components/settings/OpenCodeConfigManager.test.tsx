import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { OpenCodeConfig } from '@/api/types/settings'
import { OpenCodeConfigManager } from './OpenCodeConfigManager'

const mocks = vi.hoisted(() => ({
  getOpenCodeConfigs: vi.fn(),
  createOpenCodeConfig: vi.fn(),
  updateOpenCodeConfig: vi.fn(),
  setDefaultOpenCodeConfig: vi.fn(),
  deleteOpenCodeConfig: vi.fn(),
  listManagedSkills: vi.fn(),
  getOpenCodeImportStatus: vi.fn(),
  invalidateConfigCaches: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfigs: mocks.getOpenCodeConfigs,
    createOpenCodeConfig: mocks.createOpenCodeConfig,
    updateOpenCodeConfig: mocks.updateOpenCodeConfig,
    deleteOpenCodeConfig: mocks.deleteOpenCodeConfig,
    setDefaultOpenCodeConfig: mocks.setDefaultOpenCodeConfig,
    listManagedSkills: mocks.listManagedSkills,
    getOpenCodeImportStatus: mocks.getOpenCodeImportStatus,
    restartOpenCodeServer: vi.fn().mockResolvedValue({}),
    upgradeOpenCode: vi.fn().mockResolvedValue({ upgraded: false }),
    syncOpenCodeImport: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: vi.fn(() => ({
    data: {
      status: 'healthy',
      opencode: 'healthy',
      opencodeVersion: '1.0.0',
      opencodeManagerVersion: '1.0.0',
      database: 'connected',
      timestamp: new Date().toISOString(),
      opencodePort: 5551,
      opencodeMinVersion: '0.9.0',
      opencodeVersionSupported: true,
      error: undefined,
    },
    isLoading: false,
    restartMutation: { mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutateAsync: vi.fn(), isPending: false },
  })),
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/queryInvalidation', () => ({
  invalidateConfigCaches: mocks.invalidateConfigCaches,
}))

vi.mock('./CommandsEditor', () => ({
  CommandsEditor: ({ commands }: { commands?: Record<string, unknown> }) => (
    <div data-testid="commands-editor">Commands: {Object.keys(commands ?? {}).length}</div>
  ),
}))

vi.mock('./AgentsEditor', () => ({
  AgentsEditor: () => <div data-testid="agents-editor">Agents Editor</div>,
}))

vi.mock('./AgentsMdEditor', () => ({
  AgentsMdEditor: () => <div data-testid="agents-md-editor">AgentsMd Editor</div>,
}))

vi.mock('./McpManager', () => ({
  McpManager: () => <div data-testid="mcp-manager">MCP Manager</div>,
}))

vi.mock('./SkillsEditor', () => ({
  SkillsEditor: () => <div data-testid="skills-editor">Skills Editor</div>,
}))

vi.mock('./OpenCodeModelsEditor', () => ({
  OpenCodeModelsEditor: () => <div data-testid="models-editor">Models Editor</div>,
}))

vi.mock('./VersionSelectDialog', () => ({
  VersionSelectDialog: () => null,
}))

const createMockConfig = (overrides: Partial<OpenCodeConfig>): OpenCodeConfig => ({
  id: 1,
  name: 'default-a',
  content: {},
  rawContent: '{}',
  isValid: true,
  isDefault: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

const DEFAULT_CONFIG_LIST: OpenCodeConfig[] = [
  createMockConfig({
    id: 1,
    name: 'default-a',
    isDefault: true,
    content: { command: { cmd1: {}, cmd2: {} }, agent: {}, provider: {} },
    rawContent: JSON.stringify({ command: { cmd1: {}, cmd2: {} }, agent: {}, provider: {} }),
  }),
]

let createResolve: ((value: unknown) => void) | null = null
let updateResolve: ((value: unknown) => void) | null = null
let setDefaultResolve: ((value: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  createResolve = null
  updateResolve = null
  setDefaultResolve = null

  mocks.getOpenCodeConfigs.mockResolvedValue({ configs: DEFAULT_CONFIG_LIST, defaultConfig: DEFAULT_CONFIG_LIST[0] })
  mocks.createOpenCodeConfig.mockImplementation(
    () => new Promise((resolve) => { createResolve = resolve })
  )
  mocks.updateOpenCodeConfig.mockImplementation(
    () => new Promise((resolve) => { updateResolve = resolve })
  )
  mocks.setDefaultOpenCodeConfig.mockImplementation(
    () => new Promise((resolve) => { setDefaultResolve = resolve })
  )
  mocks.listManagedSkills.mockResolvedValue([])
  mocks.deleteOpenCodeConfig.mockResolvedValue({})
  mocks.invalidateConfigCaches.mockResolvedValue(undefined)
  mocks.getOpenCodeImportStatus.mockResolvedValue({
    configSourcePath: null,
    stateSourcePath: null,
    workspaceConfigPath: '/workspace/config.json',
    workspaceStatePath: '/workspace/state.db',
    workspaceStateExists: false,
  })

  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: () => {},
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: () => {},
    configurable: true,
  })
})

const renderManager = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { ...render(<OpenCodeConfigManager />, { wrapper }), queryClient }
}

describe('OpenCodeConfigManager', () => {
  describe('create-as-default pending behavior', () => {
    it('keeps Cancel enabled and closes dialog while create is pending', async () => {
      const user = userEvent.setup()
      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
      })

      const newConfigButton = screen.getByRole('button', { name: /new config/i })
      await user.click(newConfigButton)

      await waitFor(() => {
        expect(screen.getByText('Create OpenCode Config')).toBeInTheDocument()
      })

      const nameInput = screen.getByLabelText('Config Name')
      await user.type(nameInput, 'test-config')

      const contentTextarea = screen.getByLabelText(/Config Content/i)
      fireEvent.change(contentTextarea, { target: { value: '{"theme": "dark"}' } })

      const defaultSwitch = screen.getByRole('switch')
      await user.click(defaultSwitch)

      const createButton = screen.getByRole('button', { name: /^create$/i })
      expect(createButton).toBeEnabled()

      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(createButton).toBeDisabled()
      })

      const cancelButton = screen.getByRole('button', { name: /^cancel$/i })
      expect(cancelButton).toBeEnabled()

      await act(async () => {
        await user.click(cancelButton)
      })

      await waitFor(() => {
        expect(screen.queryByText('Create OpenCode Config')).not.toBeInTheDocument()
      })

      act(() => {
        createResolve?.({})
      })

      await act(async () => {})
    })
  })

  describe('raw edit save pending behavior', () => {
    it('keeps Cancel enabled and closes editor while save is pending', async () => {
      const user = userEvent.setup()
      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
      })

      const editButton = screen.getByRole('button', { name: /Edit config default-a/i })

      await user.click(editButton!)

      await waitFor(() => {
        expect(screen.getByText(/Edit Config: default-a/i)).toBeInTheDocument()
      })

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: '{"theme": "dark"}' } })

      await waitFor(() => {
        expect(textarea).toHaveValue('{"theme": "dark"}')
      })

      const updateButton = screen.getByRole('button', { name: /^update$/i })
      expect(updateButton).toBeEnabled()

      await act(async () => {
        await user.click(updateButton)
      })

      const editorCancelButton = screen.getByRole('button', { name: /^cancel$/i })
      expect(editorCancelButton).toBeEnabled()

      await act(async () => {
        await user.click(editorCancelButton)
      })

      await waitFor(() => {
        expect(screen.queryByText(/Edit Config:/i)).not.toBeInTheDocument()
      })

      expect(screen.getByText('default-a')).toBeInTheDocument()

      act(() => {
        updateResolve?.({})
      })

      await act(async () => {})
    })

    it('updates local config state when PUT succeeds but refresh fails', async () => {
      const user = userEvent.setup()

      const initialConfig = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: {}, agent: {}, provider: {} },
        rawContent: '{}',
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [initialConfig],
        defaultConfig: initialConfig,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
      })

      const editButton = screen.getByRole('button', { name: /Edit config default-a/i })
      await user.click(editButton)

      await waitFor(() => {
        expect(screen.getByText(/Edit Config: default-a/i)).toBeInTheDocument()
      })

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: '{"command":{"cmd1":{"description":"new"}}}' } })

      await waitFor(() => {
        expect(textarea).toHaveValue('{"command":{"cmd1":{"description":"new"}}}')
      })

      const updatedConfig: OpenCodeConfig = {
        ...initialConfig,
        updatedAt: Date.now() + 60000,
        content: { command: { cmd1: { description: 'new' } }, agent: {}, provider: {} },
        rawContent: '{"command":{"cmd1":{"description":"new"}}}',
      }

      mocks.updateOpenCodeConfig.mockResolvedValueOnce(updatedConfig)

      mocks.getOpenCodeConfigs.mockRejectedValueOnce(new Error('refresh failed'))

      const updateButton = screen.getByRole('button', { name: /^update$/i })

      await act(async () => {
        await user.click(updateButton)
      })

      await waitFor(() => {
        expect(mocks.updateOpenCodeConfig).toHaveBeenCalledWith(
          'default-a',
          { content: '{"command":{"cmd1":{"description":"new"}}}' }
        )
      }, { timeout: 5000 })

      await waitFor(() => {
        expect(mocks.getOpenCodeConfigs).toHaveBeenCalledTimes(2)
      }, { timeout: 5000 })

      const commandHeading = screen.getByText('Commands')
      const commandSection = commandHeading.closest('[class*="border"]')
      expect(commandSection).not.toBeNull()
      const countEl = within(commandSection!).getByText(/configured/)
      expect(countEl).toHaveTextContent('1 configured')

      await waitFor(() => {
        expect(screen.queryByText(/Edit Config:/i)).not.toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('selected config synchronization after set-default', () => {
    it('refreshes selected config content after setting default', async () => {
      const user = userEvent.setup()

      const configA = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: {
          command: { cmd1: {}, cmd2: {} },
          agent: {},
          provider: {},
        },
        rawContent: JSON.stringify({
          command: { cmd1: {}, cmd2: {} },
          agent: {},
          provider: {},
        }),
      })

      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: {
          command: { cmd3: {} },
          agent: { agent1: {} },
          provider: {},
        },
        rawContent: JSON.stringify({
          command: { cmd3: {} },
          agent: { agent1: {} },
          provider: {},
        }),
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const selectTrigger = screen.getByRole('combobox')
      await user.click(selectTrigger)

      await waitFor(() => {
        const options = screen.getAllByText('config-b')
        expect(options.length).toBeGreaterThanOrEqual(1)
        const optionEl = options.find(el => el.closest('[role="option"]'))
        expect(optionEl).toBeInTheDocument()
      })

      const options = screen.getAllByText('config-b')
      const configBOption = options.find(el => el.closest('[role="option"]'))
      await user.click(configBOption!)

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      })

      const configBCard = screen.getByRole('button', { name: /Set config-b as default/i })

      const configBRefreshed: OpenCodeConfig = {
        ...configB,
        isDefault: true,
        content: {
          command: { cmd3: {}, cmd4: {} },
          agent: { agent1: {}, agent2: {} },
          provider: {},
        },
        rawContent: JSON.stringify({
          command: { cmd3: {}, cmd4: {} },
          agent: { agent1: {}, agent2: {} },
          provider: {},
        }),
      }

      const defaultACleared: OpenCodeConfig = {
        ...configA,
        isDefault: false,
      }

      mocks.setDefaultOpenCodeConfig.mockResolvedValueOnce(configBRefreshed)

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [defaultACleared, configBRefreshed],
        defaultConfig: configBRefreshed,
      })

      await act(async () => {
        await user.click(configBCard!)
      })

      await act(async () => {
        setDefaultResolve?.(configBRefreshed)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await waitFor(() => {
        expect(mocks.getOpenCodeConfigs).toHaveBeenCalledTimes(2)
      })

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      }, { timeout: 3000 })

      await waitFor(() => {
        const commandHeading = screen.getByText('Commands')
        const commandSection = commandHeading.closest('[class*="border"]')
        expect(commandSection).not.toBeNull()
        const countEl = within(commandSection!).getByText(/configured/)
        expect(countEl).toHaveTextContent('2 configured')
      }, { timeout: 3000 })

      await waitFor(() => {
        const agentHeading = screen.getByText('Agents')
        const agentSection = agentHeading.closest('[class*="border"]')
        expect(agentSection).not.toBeNull()
        const agentCountEl = within(agentSection!).getByText(/configured/)
        expect(agentCountEl).toHaveTextContent('2 configured')
      }, { timeout: 3000 })

      await waitFor(() => {
        expect(mocks.invalidateConfigCaches).toHaveBeenCalled()
      })
      expect(mocks.invalidateConfigCaches.mock.calls.at(-1)?.[1]).toEqual({ clearModelData: true })
    })
  })

  describe('scoped edit pending behavior', () => {
    it('does not show loading state for non-pending config editor', async () => {
      const user = userEvent.setup()
      const configA = createMockConfig({
        id: 1,
        name: 'config-a',
        isDefault: true,
        content: { command: {}, agent: {}, provider: {} },
        rawContent: '{}',
      })
      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: { command: {}, agent: {}, provider: {} },
        rawContent: '{}',
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('config-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const editButtonA = screen.getByRole('button', { name: /Edit config config-a/i })
      await user.click(editButtonA!)

      await waitFor(() => {
        expect(screen.getByText(/Edit Config: config-a/i)).toBeInTheDocument()
      })

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: '{"theme": "dark"}' } })

      const updateButton = screen.getByRole('button', { name: /^update$/i })
      await act(async () => {
        await user.click(updateButton)
      })

      const editorCancelButton = screen.getByRole('button', { name: /^cancel$/i })
      await act(async () => {
        await user.click(editorCancelButton)
      })

      await waitFor(() => {
        expect(screen.queryByText(/Edit Config:/i)).not.toBeInTheDocument()
      })

      const editButtonB = screen.getByRole('button', { name: /Edit config config-b/i })
      await user.click(editButtonB!)

      await waitFor(() => {
        expect(screen.getByText(/Edit Config: config-b/i)).toBeInTheDocument()
      })

      const updateButtonB = screen.getByRole('button', { name: /^update$/i })
      expect(updateButtonB).toBeEnabled()

      act(() => {
        updateResolve?.({})
      })

      await act(async () => {})
    })
  })

  describe('refreshConfigs fallback order', () => {
    it('falls back to default config when preferred and current configs are absent', async () => {
      const user = userEvent.setup()
      const configA = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: { cmd1: {}, cmd2: {} }, agent: {}, provider: {} },
        rawContent: JSON.stringify({ command: { cmd1: {}, cmd2: {} }, agent: {}, provider: {} }),
      })
      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: { command: { cmd3: {} }, agent: { agent1: {} }, provider: {} },
        rawContent: JSON.stringify({ command: { cmd3: {} }, agent: { agent1: {} }, provider: {} }),
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const selectTrigger = screen.getByRole('combobox')
      await user.click(selectTrigger)

      await waitFor(() => {
        const options = screen.getAllByText('config-b')
        expect(options.length).toBeGreaterThanOrEqual(1)
        const optionEl = options.find(el => el.closest('[role="option"]'))
        expect(optionEl).toBeInTheDocument()
      })

      const options = screen.getAllByText('config-b')
      const configBOption = options.find(el => el.closest('[role="option"]'))
      await user.click(configBOption!)

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      })

      mocks.setDefaultOpenCodeConfig.mockResolvedValueOnce({ removedFields: [] })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA],
        defaultConfig: configA,
      })

      const setDefaultBCard = screen.getByRole('button', { name: /Set config-b as default/i })

      await act(async () => {
        await user.click(setDefaultBCard)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('default-a')
      }, { timeout: 5000 })
    })
  })

  describe('set-default optimistic reconciliation on refresh failure', () => {
    it('applies default flag optimistically when set-default succeeds but refresh fails', async () => {
      const user = userEvent.setup()

      const configA = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: { cmd1: {} }, agent: {}, provider: {} },
        rawContent: JSON.stringify({ command: { cmd1: {} }, agent: {}, provider: {} }),
      })
      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: { command: {}, agent: { agent1: {} }, provider: {} },
        rawContent: JSON.stringify({ command: {}, agent: { agent1: {} }, provider: {} }),
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const selectTrigger = screen.getByRole('combobox')
      await user.click(selectTrigger)

      await waitFor(() => {
        const options = screen.getAllByText('config-b')
        expect(options.length).toBeGreaterThanOrEqual(1)
        const optionEl = options.find(el => el.closest('[role="option"]'))
        expect(optionEl).toBeInTheDocument()
      })

      const options = screen.getAllByText('config-b')
      const configBOption = options.find(el => el.closest('[role="option"]'))
      await user.click(configBOption!)

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      })

      const configBAsDefault: OpenCodeConfig = {
        ...configB,
        isDefault: true,
        removedFields: ['invalid.field'],
      }
      mocks.setDefaultOpenCodeConfig.mockResolvedValueOnce(configBAsDefault)
      mocks.getOpenCodeConfigs.mockRejectedValueOnce(new Error('refresh failed'))

      const configBCard = screen.getByRole('button', { name: /Set config-b as default/i })

      await act(async () => {
        await user.click(configBCard)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await act(async () => {
        setDefaultResolve?.(configBAsDefault)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await waitFor(() => {
        expect(screen.queryByText('Current')).toBeInTheDocument()
      }, { timeout: 5000 })

      const currentBadge = screen.getByText('Current')
      expect(currentBadge.closest('[class*="border-green-500"]') || currentBadge.closest('[class*="green"]')).not.toBeNull()
    })
  })

  describe('delete optimistic reconciliation on refresh failure', () => {
    it('removes deleted config from UI when delete succeeds but refresh fails', async () => {
      const user = userEvent.setup()

      const configA = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: { cmd1: {} }, agent: {}, provider: {} },
        rawContent: JSON.stringify({ command: { cmd1: {} }, agent: {}, provider: {} }),
      })
      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: { command: {}, agent: { agent1: {} }, provider: {} },
        rawContent: JSON.stringify({ command: {}, agent: { agent1: {} }, provider: {} }),
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: /Delete config config-b/i })
      await user.click(deleteButton)

      await waitFor(() => {
        expect(screen.getAllByText('Delete Configuration').length).toBeGreaterThan(0)
      })

      mocks.deleteOpenCodeConfig.mockResolvedValueOnce({})
      mocks.getOpenCodeConfigs.mockRejectedValueOnce(new Error('refresh failed'))

      const deleteButtons = screen.getAllByText('Delete Configuration')
      const confirmButton = deleteButtons.find(el => el.closest('button'))!
      await act(async () => {
        await user.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await waitFor(() => {
        expect(screen.queryByText('config-b')).not.toBeInTheDocument()
      }, { timeout: 5000 })

      expect(screen.getByText('default-a')).toBeInTheDocument()
    })
  })

  describe('create-as-default optimistic reconciliation on refresh failure', () => {
    it('uses mutation return value when create succeeds but refresh fails', async () => {
      const user = userEvent.setup()

      const initialConfig = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: {}, agent: {}, provider: {} },
        rawContent: '{}',
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [initialConfig],
        defaultConfig: initialConfig,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
      })

      const newConfigButton = screen.getByRole('button', { name: /new config/i })
      await user.click(newConfigButton)

      await waitFor(() => {
        expect(screen.getByText('Create OpenCode Config')).toBeInTheDocument()
      })

      const nameInput = screen.getByLabelText('Config Name')
      await user.type(nameInput, 'new-default')

      const contentTextarea = screen.getByLabelText(/Config Content/i)
      fireEvent.change(contentTextarea, { target: { value: '{"theme":"dark","invalid":"field"}' } })

      const defaultSwitch = screen.getByRole('switch')
      await user.click(defaultSwitch)

      const createdConfig: OpenCodeConfig = {
        id: 42,
        name: 'new-default',
        content: { theme: 'dark' },
        rawContent: '{"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        removedFields: ['invalid'],
      }

      mocks.createOpenCodeConfig.mockResolvedValueOnce(createdConfig)
      mocks.getOpenCodeConfigs.mockRejectedValueOnce(new Error('refresh failed'))

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await act(async () => {
        await user.click(createButton)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await act(async () => {
        createResolve?.(createdConfig)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await waitFor(() => {
        expect(screen.queryByText('Create OpenCode Config')).not.toBeInTheDocument()
      }, { timeout: 5000 })

      await waitFor(() => {
        expect(screen.getByText('new-default')).toBeInTheDocument()
      }, { timeout: 5000 })

      const currentBadge = screen.getByText('Current')
      expect(currentBadge).not.toBeNull()

      await waitFor(() => {
        expect(mocks.createOpenCodeConfig).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'new-default', isDefault: true })
        )
      }, { timeout: 5000 })

      await waitFor(() => {
        expect(mocks.invalidateConfigCaches).toHaveBeenCalled()
      })
      expect(mocks.invalidateConfigCaches.mock.calls.at(-1)?.[1]).toEqual({ clearModelData: true })
    })
  })

  describe('set-default with removedFields on refresh failure', () => {
    it('uses mutation return value when set-default succeeds with removedFields but refresh fails', async () => {
      const user = userEvent.setup()

      const configA = createMockConfig({
        id: 1,
        name: 'default-a',
        isDefault: true,
        content: { command: { cmd1: {} }, agent: {}, provider: {} },
        rawContent: JSON.stringify({ command: { cmd1: {} }, agent: {}, provider: {} }),
      })
      const configB = createMockConfig({
        id: 2,
        name: 'config-b',
        isDefault: false,
        content: { command: {}, agent: { agent1: {} }, provider: {} },
        rawContent: JSON.stringify({ command: {}, agent: { agent1: {} }, provider: {} }),
      })

      mocks.getOpenCodeConfigs.mockResolvedValueOnce({
        configs: [configA, configB],
        defaultConfig: configA,
      })

      renderManager()

      await waitFor(() => {
        expect(screen.getByText('default-a')).toBeInTheDocument()
        expect(screen.getByText('config-b')).toBeInTheDocument()
      })

      const selectTrigger = screen.getByRole('combobox')
      await user.click(selectTrigger)

      await waitFor(() => {
        const options = screen.getAllByText('config-b')
        expect(options.length).toBeGreaterThanOrEqual(1)
        const optionEl = options.find(el => el.closest('[role="option"]'))
        expect(optionEl).toBeInTheDocument()
      })

      const options = screen.getAllByText('config-b')
      const configBOption = options.find(el => el.closest('[role="option"]'))
      await user.click(configBOption!)

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      })

      const configBAsDefault: OpenCodeConfig = {
        ...configB,
        isDefault: true,
        removedFields: ['invalid.field'],
        content: { command: {}, agent: { agent1: {} } },
      }
      mocks.setDefaultOpenCodeConfig.mockResolvedValueOnce(configBAsDefault)
      mocks.getOpenCodeConfigs.mockRejectedValueOnce(new Error('refresh failed'))

      const configBCard = screen.getByRole('button', { name: /Set config-b as default/i })

      await act(async () => {
        await user.click(configBCard)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await act(async () => {
        setDefaultResolve?.(configBAsDefault)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await waitFor(() => {
        expect(screen.queryByText('Current')).toBeInTheDocument()
      }, { timeout: 5000 })

      await waitFor(() => {
        expect(selectTrigger).toHaveTextContent('config-b')
      }, { timeout: 5000 })

      await waitFor(() => {
        const commandHeading = screen.getByText('Commands')
        const commandSection = commandHeading.closest('[class*="border"]')
        expect(commandSection).not.toBeNull()
        const countEl = within(commandSection!).getByText(/configured/)
        expect(countEl).toHaveTextContent('0 configured')
      }, { timeout: 3000 })
    })
  })
})
