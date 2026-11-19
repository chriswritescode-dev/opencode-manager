import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useModelSections } from './useModelSections'
import { renderHookWithProviders } from '@/test/render'
import { makeCatalogModel, makeCatalogProvider } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const catalogRoutes: FetchRoute[] = [
  {
    method: 'GET',
    path: '/api/opencode/api/provider',
    respond: () => ({ json: { data: [makeCatalogProvider({ id: 'openai', name: 'OpenAI' })] } }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({
      json: {
        data: ['gpt-4.1', 'gpt-4o', 'gpt-5'].map((id) =>
          makeCatalogModel({ id, modelID: id, name: id, providerID: 'openai' }),
        ),
      },
    }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/config',
    respond: () => ({ json: [{ type: 'document', info: { model: 'openai/gpt-5' } }] }),
  },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
  {
    method: 'GET',
    path: '/api/providers/model-state',
    respond: () => ({
      json: { recent: [], favorite: [{ providerID: 'openai', modelID: 'gpt-4o' }], variant: {} },
    }),
  },
]

describe('useModelSections', () => {
  it('builds sections from the catalog, model state and the default model', async () => {
    const { result } = renderHookWithProviders(() => useModelSections('/repo'), {
      ...hookProviders,
      fetchRoutes: catalogRoutes,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.providers.map((provider) => provider.id)).toEqual(['openai'])
    expect(result.current.providers[0].models.map((model) => model.id)).toEqual(['gpt-4.1', 'gpt-4o', 'gpt-5'])
    expect(result.current.defaultModel).toBe('openai/gpt-5')
    expect(result.current.sections.map((section) => section.key)).toEqual([
      'default',
      'favorites',
      'provider:openai',
    ])
    expect(result.current.sections.find((section) => section.key === 'provider:openai')?.options.map(
      (option) => option.modelID,
    )).toEqual(['gpt-4.1'])
  })

  it('falls back to an empty provider list and reports loading', () => {
    const pendingRoute = (path: string): FetchRoute => ({
      method: 'GET',
      path,
      respond: () => new Promise(() => {}),
    })
    const { result } = renderHookWithProviders(() => useModelSections('/repo'), {
      ...hookProviders,
      fetchRoutes: [
        pendingRoute('/api/opencode/api/provider'),
        pendingRoute('/api/opencode/api/model'),
        pendingRoute('/api/opencode/api/config'),
        pendingRoute('/api/opencode/api/model/default'),
        pendingRoute('/api/providers/model-state'),
      ],
    })

    expect(result.current.providers).toEqual([])
    expect(result.current.sections).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })
})
