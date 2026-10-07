import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useModelSections } from './useModelSections'
import type { Provider } from '@/api/providers'

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
}))

vi.mock('./useProviders', () => ({ useProviders: mocks.useProviders }))
vi.mock('./useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
}))

const providers: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5', key: 'gpt-5', name: 'GPT-5', released: 0, free: false },
      { id: 'gpt-4o', key: 'gpt-4o', name: 'GPT-4o', released: 0, free: false },
      { id: 'gpt-4.1', key: 'gpt-4.1', name: 'GPT-4.1', released: 0, free: false },
    ],
  },
]

describe('useModelSections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] }, isLoading: false })
    mocks.useOpenCodeModelState.mockReturnValue({
      data: { favorite: [{ providerID: 'openai', modelID: 'gpt-4o' }], recent: [], variant: {} },
      isLoading: false,
    })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: 'openai/gpt-5', isLoading: false })
  })

  it('builds sections from the catalog, model state and the default model', () => {
    const { result } = renderHook(() => useModelSections('/repo'))

    expect(result.current.providers).toBe(providers)
    expect(result.current.sections.map((section) => section.key)).toEqual(['default', 'favorites', 'provider:openai'])
    expect(result.current.defaultModel).toBe('openai/gpt-5')
    expect(result.current.isLoading).toBe(false)
  })

  it('falls back to an empty provider list and reports loading', () => {
    mocks.useProviders.mockReturnValue({ data: undefined, isLoading: true })
    mocks.useOpenCodeModelState.mockReturnValue({ data: undefined, isLoading: true })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: undefined, isLoading: true })

    const { result } = renderHook(() => useModelSections('/repo'))

    expect(result.current.providers).toEqual([])
    expect(result.current.sections).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })
})
