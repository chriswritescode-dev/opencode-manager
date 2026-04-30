import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useModelSelection } from './useModelSelection'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import * as useOpenCodeExports from './useOpenCode'
import * as providersApi from '@/api/providers'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

vi.mock('./useOpenCode', async () => {
  const actual = await vi.importActual('./useOpenCode')
  return {
    ...actual,
    useConfig: vi.fn(),
    useOpenCodeClient: vi.fn(),
  }
})

vi.mock('@/api/providers', async () => {
  const actual = await vi.importActual('@/api/providers')
  return {
    ...actual,
    getProviders: vi.fn(),
    getOpenCodeModelState: vi.fn(),
    addOpenCodeRecentModel: vi.fn(),
    toggleOpenCodeFavoriteModel: vi.fn(),
  }
})

vi.mock('zustand/middleware', async () => {
  const actual = await vi.importActual('zustand/middleware')
  return {
    ...actual,
    persist: (config: any) => config,
  }
})

const mockUseConfig = vi.mocked(useOpenCodeExports.useConfig)
const mockUseOpenCodeClient = vi.mocked(useOpenCodeExports.useOpenCodeClient)
const mockGetProviders = vi.mocked(providersApi.getProviders)
const mockGetOpenCodeModelState = vi.mocked(providersApi.getOpenCodeModelState)
const mockAddOpenCodeRecentModel = vi.mocked(providersApi.addOpenCodeRecentModel)
const mockToggleOpenCodeFavoriteModel = vi.mocked(providersApi.toggleOpenCodeFavoriteModel)

describe('useModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.getState().setModel({ providerID: 'test', modelID: 'test-model' })
    useModelStore.getState().setActiveModel({ providerID: 'test', modelID: 'test-model' })
    
    mockUseConfig.mockReturnValue({ data: undefined, isLoading: false } as any)
    mockUseOpenCodeClient.mockReturnValue({} as any)
    mockGetProviders.mockResolvedValue({
      providers: [],
      connected: [],
      default: {},
    })
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
    mockAddOpenCodeRecentModel.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
    mockToggleOpenCodeFavoriteModel.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: {},
    })
  })

  const renderHookWithProviders = () => {
    const queryClient = createTestQueryClient()
    return renderHook(
      () => useModelSelection('http://localhost:5551', '/test'),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    )
  }

  it('does not restore before providers are loaded', async () => {
    mockGetProviders.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHookWithProviders()

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(false)
    expect(useModelStore.getState().model).not.toEqual(testModel)
  })

  it('restores when model exists in providers', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
          },
          isConnected: true,
          env: [],
          options: {},
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(true)
    expect(useModelStore.getState().model).toEqual(testModel)
    expect(useModelStore.getState().recentModels).toEqual([])
  })

  it('rejects unknown model after providers are loaded', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
          },
          isConnected: true,
          env: [],
          options: {},
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const initialModel = useModelStore.getState().model
    const initialRecentModels = useModelStore.getState().recentModels
    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'missing-model' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(false)
    expect(useModelStore.getState().model).toEqual(initialModel)
    expect(useModelStore.getState().recentModels).toEqual(initialRecentModels)
  })

  it('user selection still updates recents', async () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
          },
          isConnected: true,
          env: [],
          options: {},
        },
      ],
      connected: ['anthropic'],
      default: {},
    }

    mockGetProviders.mockResolvedValue(providersData as any)
    mockAddOpenCodeRecentModel.mockResolvedValue({
      recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
      favorite: [],
      variant: {},
    })

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.setModel(testModel)

    expect(useModelStore.getState().model).toEqual(testModel)
    expect(useModelStore.getState().recentModels[0]).toEqual(testModel)
    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalled()
      expect(mockAddOpenCodeRecentModel.mock.calls[0][0]).toEqual(testModel)
    })
  })
})
