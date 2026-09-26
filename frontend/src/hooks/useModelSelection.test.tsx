import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useModelSelection } from './useModelSelection'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import * as providersApi from '@/api/providers'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

vi.mock('@/api/providers', async () => {
  const actual = await vi.importActual('@/api/providers')
  return {
    ...actual,
    getProviders: vi.fn(),
    getOpenCodeConfigModel: vi.fn(),
    getOpenCodeModelState: vi.fn(),
    addOpenCodeRecentModel: vi.fn(),
    removeOpenCodeRecentModel: vi.fn(),
    toggleOpenCodeFavoriteModel: vi.fn(),
  }
})

const mockGetProviders = vi.mocked(providersApi.getProviders)
const mockGetOpenCodeConfigModel = vi.mocked(providersApi.getOpenCodeConfigModel)
const mockGetOpenCodeModelState = vi.mocked(providersApi.getOpenCodeModelState)
const mockAddOpenCodeRecentModel = vi.mocked(providersApi.addOpenCodeRecentModel)
const mockRemoveOpenCodeRecentModel = vi.mocked(providersApi.removeOpenCodeRecentModel)
const mockToggleOpenCodeFavoriteModel = vi.mocked(providersApi.toggleOpenCodeFavoriteModel)

describe('useModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.getState().setModel({ providerID: 'test', modelID: 'test-model' })
    useModelStore.getState().setActiveModel({ providerID: 'test', modelID: 'test-model' })
    
    mockGetProviders.mockResolvedValue({
      providers: [],
      connected: [],
    })
    mockGetOpenCodeConfigModel.mockResolvedValue(null)
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
    mockRemoveOpenCodeRecentModel.mockResolvedValue({
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
      () => useModelSelection('/test'),
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
    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'missing-model' }
    const returnValue = result.current.setActiveModel(testModel)

    expect(returnValue).toBe(false)
    expect(useModelStore.getState().model).toEqual(initialModel)
  })

  describe('recentModels/favoriteModels derived from React Query', () => {
    it('filters out models not present in providers', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [
          { providerID: 'AI2', modelID: 'foo' },
          { providerID: 'GreatScott', modelID: 'mimo' },
        ],
        favorite: [
          { providerID: 'VLLM', modelID: 'bar' },
          { providerID: 'GreatScott', modelID: 'mimo' },
        ],
        variant: {},
      })
      mockGetProviders.mockResolvedValue({
        providers: [
          {
            id: 'AI2',
            name: 'AI2',
            models: { foo: { id: 'foo', name: 'Foo' } },
            isConnected: true,
            env: [],
            options: {},
          },
          {
            id: 'VLLM',
            name: 'VLLM',
            models: { bar: { id: 'bar', name: 'Bar' } },
            isConnected: true,
            env: [],
            options: {},
          },
        ],
        connected: ['AI2', 'VLLM'],
      } as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      await waitFor(() => {
        expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
      })
    })

    it('returns raw values when providers query is loading (undefined)', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
        variant: {},
      })
      mockGetProviders.mockImplementation(() => new Promise(() => {}))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })

    it('returns raw values when providers returns empty array', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
        variant: {},
      })
      mockGetProviders.mockResolvedValue({
        providers: [],
        connected: [],
      } as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })
  })

  describe('startup model resolution', () => {
    const providersData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
            'claude-opus-4': { id: 'claude-opus-4', name: 'Claude Opus 4' },
          },
          isConnected: true,
          env: [],
          options: {},
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
          },
          isConnected: true,
          env: [],
          options: {},
        },
      ],
      connected: ['anthropic', 'openai'],
    }

    const recentState = (recent: ModelSelection[]) => ({ recent, favorite: [], variant: {} })

    it('prefers the config model over a recent model', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeConfigModel.mockResolvedValue('anthropic/claude-opus-4')
      mockGetOpenCodeModelState.mockResolvedValue(recentState([{ providerID: 'openai', modelID: 'gpt-4o' }]))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
      })
      expect(mockGetOpenCodeConfigModel).toHaveBeenCalledWith('/test')
    })

    it('falls through an unavailable config model to the first valid recent model', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeConfigModel.mockResolvedValue('anthropic/missing-model')
      mockGetOpenCodeModelState.mockResolvedValue(recentState([
        { providerID: 'ghost', modelID: 'gone' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ]))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('prefers a valid recent model over the first available model', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeModelState.mockResolvedValue(recentState([{ providerID: 'openai', modelID: 'gpt-4o' }]))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('falls back to the first available model without config or recent models', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('waits for the config model to settle before resolving', async () => {
      let resolveConfigModel: (value: string | null) => void = () => {}
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeConfigModel.mockImplementation(() => new Promise((resolve) => {
        resolveConfigModel = resolve
      }))
      mockGetOpenCodeModelState.mockResolvedValue(recentState([
        { providerID: 'ghost', modelID: 'gone' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ]))

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'openai', modelID: 'gpt-4o' }])
      })
      expect(result.current.model).toEqual({ providerID: 'test', modelID: 'test-model' })

      act(() => {
        resolveConfigModel('anthropic/claude-opus-4')
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
      })
    })

    it('keeps an explicit in-memory selection across a refresh', async () => {
      mockGetProviders.mockResolvedValue(providersData as any)
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
        favorite: [],
        variant: {},
      })
      useModelStore.getState().setModel({ providerID: 'openai', modelID: 'gpt-4o' })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(mockGetProviders).toHaveBeenCalled()
      })

      expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
    })
  })

  it('toggleFavorite calls toggleOpenCodeFavoriteModel and does not mutate Zustand', async () => {
    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.toggleFavorite(testModel)

    await waitFor(() => {
      expect(mockToggleOpenCodeFavoriteModel).toHaveBeenCalledTimes(1)
    })
    expect(mockToggleOpenCodeFavoriteModel.mock.calls[0][0]).toEqual(testModel)
    expect(useModelStore.getState().model).not.toEqual(testModel)
  })

  it('removes recent models optimistically and rolls back on failure', async () => {
    const removedModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const retainedModel: ModelSelection = { providerID: 'openai', modelID: 'gpt-4.1' }
    let rejectRemove: (error: Error) => void = () => {}
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [removedModel, retainedModel],
      favorite: [],
      variant: {},
    })
    mockRemoveOpenCodeRecentModel.mockImplementation(() => new Promise((_, reject) => {
      rejectRemove = reject
    }))

    const { result } = renderHookWithProviders()

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([removedModel, retainedModel])
    })

    act(() => {
      result.current.removeRecentModel(removedModel)
    })

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([retainedModel])
    })

    act(() => {
      rejectRemove(new Error('remove failed'))
    })

    await waitFor(() => {
      expect(result.current.recentModels).toEqual([removedModel, retainedModel])
    })
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
    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalled()
      expect(mockAddOpenCodeRecentModel.mock.calls[0][0]).toEqual(testModel)
    })

    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalledTimes(1)
    })
  })

  it('restoreSessionModel sets model without requiring providers', async () => {
    mockGetProviders.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHookWithProviders()

    const sessionModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    result.current.restoreSessionModel(sessionModel)

    expect(useModelStore.getState().model).toEqual(sessionModel)
  })
})
