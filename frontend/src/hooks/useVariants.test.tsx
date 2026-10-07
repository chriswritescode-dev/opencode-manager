import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useVariants } from './useVariants'
import { useModelStore } from '@/stores/modelStore'
import { modelStateQueryKey, useModelSelection, type ModelSelectionSession } from './useModelSelection'
import * as providersApi from '@/api/providers'
import type { Provider } from '@/api/providers'
import type { ModelInfo } from '@opencode-manager/shared/opencode'

vi.mock('@/api/providers', async () => {
  const actual = await vi.importActual('@/api/providers')
  return {
    ...actual,
    getProviders: vi.fn(),
    getOpenCodeConfiguredModel: vi.fn(),
    getOpenCodeModelState: vi.fn(),
    saveOpenCodeModelVariant: vi.fn(),
    addOpenCodeRecentModel: vi.fn(),
    removeOpenCodeRecentModel: vi.fn(),
    toggleOpenCodeFavoriteModel: vi.fn(),
  }
})

const mockGetProviders = vi.mocked(providersApi.getProviders)
const mockGetOpenCodeConfiguredModel = vi.mocked(providersApi.getOpenCodeConfiguredModel)
const mockGetOpenCodeModelState = vi.mocked(providersApi.getOpenCodeModelState)
const mockSaveOpenCodeModelVariant = vi.mocked(providersApi.saveOpenCodeModelVariant)
const mockAddOpenCodeRecentModel = vi.mocked(providersApi.addOpenCodeRecentModel)

const PROVIDER_ID = 'anthropic'
const MODEL_ID = 'claude-sonnet-4'
const MODEL_KEY = `${PROVIDER_ID}/${MODEL_ID}`
const DIRECTORY = '/test'
const AGENT_ID = 'build'

const modelInfo = (variants: string[]): ModelInfo => ({
  providerID: PROVIDER_ID,
  id: MODEL_ID,
  modelID: MODEL_ID,
  name: MODEL_ID,
  enabled: true,
  status: 'active',
  variants: variants.map((id) => ({ id })),
  time: { released: 0 },
  cost: [],
  limit: { context: 0, output: 0 },
} as unknown as ModelInfo)

const provider = (): Provider => ({
  id: PROVIDER_ID,
  name: 'Anthropic',
  models: [{ id: MODEL_ID, key: MODEL_ID, name: MODEL_ID, released: 0, free: false }],
})

const emptyState = () => ({ recent: [], favorite: [], variant: {} })

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

const createWrapper = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

const renderUseVariants = (queryClient: QueryClient, session?: ModelSelectionSession) =>
  renderHook(() => useVariants(DIRECTORY, session), { wrapper: createWrapper(queryClient) })

const selectAgentModel = (variant?: string) => {
  useModelStore.getState().setActiveAgent({
    id: AGENT_ID,
    model: { providerID: PROVIDER_ID, id: MODEL_ID, ...(variant ? { variant } : {}) },
  })
}

describe('useVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })

    mockGetProviders.mockResolvedValue({
      providers: [provider()],
      models: [modelInfo(['default', 'high', 'low'])],
    })
    mockGetOpenCodeConfiguredModel.mockResolvedValue(null)
    mockGetOpenCodeModelState.mockResolvedValue(emptyState())
    mockSaveOpenCodeModelVariant.mockImplementation(async (model, value) => ({
      recent: [],
      favorite: [],
      variant: { [`${model.providerID}/${model.modelID}`]: value ?? 'default' },
    }))
  })

  it('uses the saved model.json variant when the selection has no variant', async () => {
    selectAgentModel()
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: { [MODEL_KEY]: 'high' },
    })

    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('treats a saved default as no variant, beating the agent variant', async () => {
    selectAgentModel('high')
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: { [MODEL_KEY]: 'default' },
    })

    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.hasVariants).toBe(true))
    expect(result.current.currentVariant).toBeUndefined()
  })

  it('falls back to the agent variant when nothing is saved', async () => {
    selectAgentModel('high')

    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('falls back to the configured variant when the agent has none', async () => {
    selectAgentModel()
    mockGetOpenCodeConfiguredModel.mockResolvedValue(`${MODEL_KEY}#low`)

    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.currentVariant).toBe('low'))
  })

  it('ignores a variant that is not in the model variants', async () => {
    selectAgentModel('turbo')

    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.hasVariants).toBe(true))
    expect(result.current.currentVariant).toBeUndefined()
  })

  it('uses the durable session variant over the saved preference', async () => {
    selectAgentModel()
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: { [MODEL_KEY]: 'low' },
    })

    const { result } = renderUseVariants(createQueryClient(), {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID, variant: 'high' },
    })

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('stores a session variant on the session pick and persists it', async () => {
    selectAgentModel()
    const { result } = renderUseVariants(createQueryClient(), {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID },
    })

    await waitFor(() => expect(result.current.hasVariants).toBe(true))

    act(() => {
      result.current.setVariant('high')
    })

    expect(useModelStore.getState().sessionPicks.s1[AGENT_ID].variant).toBe('high')
    await waitFor(() => {
      expect(mockSaveOpenCodeModelVariant).toHaveBeenCalledWith(
        { providerID: PROVIDER_ID, modelID: MODEL_ID },
        'high',
      )
    })

    act(() => {
      result.current.clearVariant()
    })

    expect(useModelStore.getState().sessionPicks.s1[AGENT_ID].variant).toBeUndefined()
    await waitFor(() => {
      expect(mockSaveOpenCodeModelVariant).toHaveBeenLastCalledWith(
        { providerID: PROVIDER_ID, modelID: MODEL_ID },
        undefined,
      )
    })
  })

  it('persists the variant outside a session and drives the selection from the preference', async () => {
    selectAgentModel()
    const queryClient = createQueryClient()
    const { result } = renderUseVariants(queryClient)

    await waitFor(() => expect(result.current.hasVariants).toBe(true))

    act(() => {
      result.current.setVariant('high')
    })

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
    expect(useModelStore.getState().newSessionPicks).toEqual({})
    await waitFor(() => {
      expect(mockSaveOpenCodeModelVariant).toHaveBeenCalledWith(
        { providerID: PROVIDER_ID, modelID: MODEL_ID },
        'high',
      )
    })

    act(() => {
      result.current.clearVariant()
    })

    await waitFor(() => expect(result.current.currentVariant).toBeUndefined())
  })

  it('cycles through named variants and wraps back to none', async () => {
    selectAgentModel()
    const { result } = renderUseVariants(createQueryClient())

    await waitFor(() => expect(result.current.hasVariants).toBe(true))

    act(() => {
      result.current.cycleVariant()
    })
    await waitFor(() => expect(result.current.currentVariant).toBe('high'))

    act(() => {
      result.current.cycleVariant()
    })
    await waitFor(() => expect(result.current.currentVariant).toBe('low'))

    act(() => {
      result.current.cycleVariant()
    })
    await waitFor(() => expect(result.current.currentVariant).toBeUndefined())
  })

  it('rolls back the optimistic variant when the save fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    selectAgentModel()
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: { [MODEL_KEY]: 'low' },
    })

    let rejectSave: (error: Error) => void = () => {}
    mockSaveOpenCodeModelVariant.mockImplementation(() => new Promise((_, reject) => {
      rejectSave = reject
    }))

    const queryClient = createQueryClient()
    const { result } = renderUseVariants(queryClient)

    await waitFor(() => expect(result.current.currentVariant).toBe('low'))

    act(() => {
      result.current.setVariant('high')
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<{ variant: Record<string, string> }>(modelStateQueryKey())?.variant)
        .toEqual({ [MODEL_KEY]: 'high' })
    })

    act(() => {
      rejectSave(new Error('save failed'))
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<{ variant: Record<string, string> }>(modelStateQueryKey())?.variant)
        .toEqual({ [MODEL_KEY]: 'low' })
    })
  })

  it('keeps the durable session variant after setModel records the same model as a recent', async () => {
    selectAgentModel()
    mockGetOpenCodeModelState.mockResolvedValue({
      recent: [],
      favorite: [],
      variant: { [MODEL_KEY]: 'low' },
    })
    mockAddOpenCodeRecentModel.mockResolvedValue({
      recent: [{ providerID: PROVIDER_ID, modelID: MODEL_ID }],
      favorite: [],
      variant: { [MODEL_KEY]: 'low' },
    })

    const session: ModelSelectionSession = {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID, variant: 'high' },
    }

    const { result } = renderHook(
      () => ({ variants: useVariants(DIRECTORY, session), selection: useModelSelection(DIRECTORY, session) }),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => expect(result.current.variants.currentVariant).toBe('high'))

    act(() => {
      result.current.selection.setModel({ providerID: PROVIDER_ID, modelID: MODEL_ID })
    })

    await waitFor(() => expect(result.current.variants.currentVariant).toBe('high'))
    expect(useModelStore.getState().sessionPicks.s1?.[AGENT_ID]).toBeUndefined()
  })
})
