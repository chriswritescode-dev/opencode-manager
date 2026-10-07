import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useModelSelection, useOpenCodeDefaultModel } from './useModelSelection'
import { useProviders } from './useProviders'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import * as providersApi from '@/api/providers'
import type { Provider } from '@/api/providers'
import type { ModelInfo } from '@opencode-manager/shared/opencode'

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
    getOpenCodeConfiguredModel: vi.fn(),
    getOpenCodeServerDefaultModel: vi.fn(),
    getOpenCodeModelState: vi.fn(),
    addOpenCodeRecentModel: vi.fn(),
    removeOpenCodeRecentModel: vi.fn(),
    toggleOpenCodeFavoriteModel: vi.fn(),
  }
})

const mockGetProviders = vi.mocked(providersApi.getProviders)
const mockGetOpenCodeConfiguredModel = vi.mocked(providersApi.getOpenCodeConfiguredModel)
const mockGetOpenCodeServerDefaultModel = vi.mocked(providersApi.getOpenCodeServerDefaultModel)
const mockGetOpenCodeModelState = vi.mocked(providersApi.getOpenCodeModelState)
const mockAddOpenCodeRecentModel = vi.mocked(providersApi.addOpenCodeRecentModel)
const mockRemoveOpenCodeRecentModel = vi.mocked(providersApi.removeOpenCodeRecentModel)
const mockToggleOpenCodeFavoriteModel = vi.mocked(providersApi.toggleOpenCodeFavoriteModel)

const modelInfo = (providerID: string, id: string, variants: string[] = []): ModelInfo => ({
  providerID,
  id,
  modelID: id,
  name: id,
  enabled: true,
  status: 'active',
  variants: variants.map((variant) => ({ id: variant })),
  time: { released: 0 },
  cost: [],
  limit: { context: 0, output: 0 },
} as unknown as ModelInfo)

const provider = (id: string, name: string, modelIDs: string[]): Provider => ({
  id,
  name,
  models: modelIDs.map((modelID) => ({
    id: modelID,
    key: modelID,
    name: modelID,
    released: 0,
    free: false,
  })),
})

const emptyState = () => ({ recent: [], favorite: [], variant: {} })

describe('useModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })

    mockGetProviders.mockResolvedValue({ providers: [], models: [] })
    mockGetOpenCodeConfiguredModel.mockResolvedValue(null)
    mockGetOpenCodeModelState.mockResolvedValue(emptyState())
    mockAddOpenCodeRecentModel.mockResolvedValue(emptyState())
    mockRemoveOpenCodeRecentModel.mockResolvedValue(emptyState())
    mockToggleOpenCodeFavoriteModel.mockResolvedValue(emptyState())
  })

  const renderHookWithProviders = (directory = '/test') => {
    const queryClient = createTestQueryClient()
    return renderHook(
      () => useModelSelection(directory),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    )
  }

  describe('new-session selection order', () => {
    const anthropic = provider('anthropic', 'Anthropic', ['claude-sonnet-4'])
    const openai = provider('openai', 'OpenAI', ['gpt-4o'])
    const catalog = {
      providers: [anthropic, openai],
      models: [modelInfo('anthropic', 'claude-sonnet-4'), modelInfo('openai', 'gpt-4o')],
    }

    it('prefers the active agent model over the configured model', async () => {
      mockGetProviders.mockResolvedValue(catalog)
      mockGetOpenCodeConfiguredModel.mockResolvedValue('openai/gpt-4o')
      useModelStore.getState().setActiveAgent({
        id: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('prefers the configured model over the recent list', async () => {
      mockGetProviders.mockResolvedValue(catalog)
      mockGetOpenCodeConfiguredModel.mockResolvedValue('openai/gpt-4o')
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
        favorite: [],
        variant: {},
      })
      useModelStore.getState().setActiveAgent({ id: 'build' })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('uses the first valid recent and skips an invalid one', async () => {
      mockGetProviders.mockResolvedValue(catalog)
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [
          { providerID: 'ghost', modelID: 'gone' },
          { providerID: 'openai', modelID: 'gpt-4o' },
        ],
        favorite: [],
        variant: {},
      })
      useModelStore.getState().setActiveAgent({ id: 'build' })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('falls back to the first catalog model', async () => {
      mockGetProviders.mockResolvedValue(catalog)
      useModelStore.getState().setActiveAgent({ id: 'build' })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('remembers a user pick per directory and agent', async () => {
      mockGetProviders.mockResolvedValue(catalog)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setActiveAgent({ id: 'a' })
      })
      act(() => {
        result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })

      act(() => {
        result.current.setActiveAgent({ id: 'b' })
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })

      act(() => {
        result.current.setActiveAgent({ id: 'a' })
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('returns null when the catalog is not loaded', () => {
      mockGetProviders.mockImplementation(() => new Promise(() => {}))

      const { result } = renderHookWithProviders()

      expect(result.current.model).toBeNull()
    })

    it('does not record a recent when the active agent changes', async () => {
      mockGetProviders.mockResolvedValue(catalog)

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setActiveAgent({ id: 'a', model: { providerID: 'openai', id: 'gpt-4o' } })
      })
      act(() => {
        result.current.setActiveAgent({ id: 'b' })
      })

      expect(mockAddOpenCodeRecentModel).not.toHaveBeenCalled()
    })
  })

  describe('readiness', () => {
    const catalog = {
      providers: [provider('anthropic', 'Anthropic', ['claude-sonnet-4'])],
      models: [modelInfo('anthropic', 'claude-sonnet-4')],
    }

    it('is not ready and returns null while the model state loads', () => {
      mockGetProviders.mockResolvedValue(catalog)
      mockGetOpenCodeModelState.mockImplementation(() => new Promise(() => {}))

      const { result } = renderHookWithProviders()

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()
    })

    it('is not ready and returns null while the configured model loads', () => {
      mockGetProviders.mockResolvedValue(catalog)
      mockGetOpenCodeConfiguredModel.mockImplementation(() => new Promise(() => {}))

      const { result } = renderHookWithProviders()

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()
    })

    it('returns null while a directory switch serves placeholder catalog data', async () => {
      const catalogA = {
        providers: [provider('anthropic', 'Anthropic', ['claude-sonnet-4'])],
        models: [modelInfo('anthropic', 'claude-sonnet-4')],
      }
      const catalogB = {
        providers: [provider('openai', 'OpenAI', ['gpt-4o'])],
        models: [modelInfo('openai', 'gpt-4o')],
      }
      let resolveB: (value: typeof catalogB) => void = () => {}
      mockGetProviders.mockImplementation((directory?: string) => {
        if (directory === '/b') return new Promise((resolve) => { resolveB = resolve })
        return Promise.resolve(catalogA)
      })

      const queryClient = createTestQueryClient()
      const { result, rerender } = renderHook(
        ({ directory }: { directory: string }) => useModelSelection(directory),
        {
          initialProps: { directory: '/a' },
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })

      rerender({ directory: '/b' })

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()

      await act(async () => {
        resolveB(catalogB)
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })
  })

  describe('session selection', () => {
    const anthropic = provider('anthropic', 'Anthropic', ['claude-sonnet-4'])
    const openai = provider('openai', 'OpenAI', ['gpt-4o'])
    const catalog = {
      providers: [anthropic, openai],
      models: [modelInfo('anthropic', 'claude-sonnet-4', ['high', 'low']), modelInfo('openai', 'gpt-4o')],
    }

    const renderSession = (session: { id: string; agent?: string; model?: { providerID: string; id: string; variant?: string } }) => {
      const queryClient = createTestQueryClient()
      return renderHook(
        () => useModelSelection('/test', session),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      )
    }

    beforeEach(() => {
      mockGetProviders.mockResolvedValue(catalog)
      useModelStore.getState().setActiveAgent({ id: 'build' })
    })

    it('uses the durable session model with its variant', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4', variant: 'high' },
      })

      await waitFor(() => {
        expect(result.current.selection).toEqual({
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4',
          variant: 'high',
        })
      })
    })

    it('does not write to the store when viewing a session', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      expect(useModelStore.getState().sessionPicks).toEqual({})
      expect(useModelStore.getState().newSessionPicks).toEqual({})
    })

    it('prefers a session pick over the durable selection', async () => {
      useModelStore.getState().setSessionPick('s1', 'build', {
        providerID: 'openai',
        modelID: 'gpt-4o',
      })

      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('ignores the durable selection when the session agent differs from the active agent', async () => {
      useModelStore.getState().setActiveAgent({ id: 'plan' })

      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('treats a default session variant as no variant without saved-preference fallback', async () => {
      mockGetOpenCodeModelState.mockResolvedValue({
        recent: [],
        favorite: [],
        variant: { 'anthropic/claude-sonnet-4': 'high' },
      })

      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4', variant: 'default' },
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
      expect(result.current.selection?.variant).toBeUndefined()
    })

    it('drops the session variant when the model does not declare it', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'openai', id: 'gpt-4o', variant: 'high' },
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
      expect(result.current.selection?.variant).toBeUndefined()
    })

    it('stores an explicit pick for the session agent', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
      })

      expect(useModelStore.getState().sessionPicks['s1'].build).toEqual({
        providerID: 'openai',
        modelID: 'gpt-4o',
      })
      await waitFor(() => {
        expect(mockAddOpenCodeRecentModel).toHaveBeenCalledTimes(1)
      })
    })

    it('drops the session draft when the pick equals the durable selection', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setModel({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })

      expect(useModelStore.getState().sessionPicks['s1']?.build).toBeUndefined()
    })

    it('does not mutate picks when the active agent switches inside a session', async () => {
      const { result } = renderSession({
        id: 's1',
        agent: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setActiveAgent({ id: 'plan' })
      })
      act(() => {
        result.current.setActiveAgent({ id: 'build' })
      })

      expect(useModelStore.getState().sessionPicks).toEqual({})
      expect(useModelStore.getState().newSessionPicks).toEqual({})
    })
  })

  it('records a recent on setModel', async () => {
    mockGetProviders.mockResolvedValue({ providers: [], models: [] })

    const { result } = renderHookWithProviders()

    act(() => {
      result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
    })

    await waitFor(() => {
      expect(mockAddOpenCodeRecentModel).toHaveBeenCalledTimes(1)
    })
    expect(mockAddOpenCodeRecentModel.mock.calls[0][0]).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
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
          provider('AI2', 'AI2', ['foo']),
          provider('VLLM', 'VLLM', ['bar']),
        ],
        models: [modelInfo('AI2', 'foo'), modelInfo('VLLM', 'bar')],
      })

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
      mockGetProviders.mockResolvedValue({ providers: [], models: [] })

      const { result } = renderHookWithProviders()

      await waitFor(() => {
        expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }])
      })

      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })
  })

  it('toggleFavorite calls toggleOpenCodeFavoriteModel and does not mutate the store', async () => {
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
    expect(useModelStore.getState().newSessionPicks).toEqual({})
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
})

describe('useOpenCodeDefaultModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeConfiguredModel.mockResolvedValue(null)
    mockGetOpenCodeServerDefaultModel.mockResolvedValue(null)
  })

  const renderDefaultModel = (directory = '/test') => {
    const queryClient = createTestQueryClient()
    return renderHook(
      () => ({
        providers: useProviders(directory),
        defaultModel: useOpenCodeDefaultModel(directory),
      }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    )
  }

  it('prefers a configured model that is listed, with its variant', async () => {
    mockGetOpenCodeConfiguredModel.mockResolvedValue('anthropic/claude-sonnet-4#thinking')
    mockGetProviders.mockResolvedValue({
      providers: [provider('anthropic', 'Anthropic', ['claude-sonnet-4'])],
      models: [modelInfo('anthropic', 'claude-sonnet-4')],
    })

    const { result } = renderDefaultModel()

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('anthropic/claude-sonnet-4#thinking')
    })
  })

  it('falls back to the server default when the configured model is not listed', async () => {
    mockGetOpenCodeConfiguredModel.mockResolvedValue('openai/retired')
    mockGetOpenCodeServerDefaultModel.mockResolvedValue({ providerID: 'openai', id: 'gpt-4o' })
    mockGetProviders.mockResolvedValue({
      providers: [provider('openai', 'OpenAI', ['gpt-4o'])],
      models: [modelInfo('openai', 'gpt-4o')],
    })

    const { result } = renderDefaultModel()

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('openai/gpt-4o')
    })
  })

  it('falls back to the first enabled model when neither is available', async () => {
    mockGetProviders.mockResolvedValue({
      providers: [provider('anthropic', 'Anthropic', ['claude-sonnet-4'])],
      models: [modelInfo('anthropic', 'claude-sonnet-4')],
    })

    const { result } = renderDefaultModel()

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('anthropic/claude-sonnet-4')
    })
  })

  it('fetches the catalog once when both hooks are mounted for the same directory', async () => {
    mockGetProviders.mockResolvedValue({
      providers: [provider('anthropic', 'Anthropic', ['claude-sonnet-4'])],
      models: [modelInfo('anthropic', 'claude-sonnet-4')],
    })

    const { result } = renderDefaultModel()

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBeDefined()
    })
    expect(mockGetProviders).toHaveBeenCalledTimes(1)
  })
})
