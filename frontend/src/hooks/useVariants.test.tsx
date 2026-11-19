import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { z } from 'zod'
import type { ModelInfo, ModelRef } from '@opencode-manager/shared/opencode'
import type { OpenCodeModelState } from '@/api/providers'
import { useVariants } from './useVariants'
import { modelStateQueryKey, useModelSelection, type ModelSelectionSession } from './useModelSelection'
import { useModelStore } from '@/stores/modelStore'
import { renderHookWithProviders } from '@/test/render'
import { makeCatalogModel, makeCatalogProvider } from '@/test/fixtures/api'
import type { FetchFake, FetchRoute } from '@/test/fetchFake'

const PROVIDER_ID = 'anthropic'
const MODEL_ID = 'claude-sonnet-4'
const MODEL_KEY = `${PROVIDER_ID}/${MODEL_ID}`
const DIRECTORY = '/test'
const AGENT_ID = 'build'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const modelInfo: ModelInfo = makeCatalogModel({
  providerID: PROVIDER_ID,
  id: MODEL_ID,
  modelID: MODEL_ID,
  name: MODEL_ID,
  variants: [{ id: 'default' }, { id: 'high' }, { id: 'low' }],
})

const saveBodySchema = z.object({
  variant: z
    .object({
      model: z.object({ providerID: z.string(), modelID: z.string() }),
      value: z.string().nullable(),
    })
    .optional(),
})

interface ModelServer {
  routes: FetchRoute[]
  setState: (state: OpenCodeModelState) => void
  setConfiguredModel: (model: string | null) => void
  failSaves: () => void
  deferSaves: () => () => void
}

function modelServer(initial: OpenCodeModelState = { recent: [], favorite: [], variant: {} }): ModelServer {
  let state = initial
  let configuredModel: string | null = null
  let savesFail = false
  let pendingSave: Promise<void> | null = null

  return {
    setState: (next) => {
      state = next
    },
    setConfiguredModel: (model) => {
      configuredModel = model
    },
    failSaves: () => {
      savesFail = true
    },
    deferSaves: () => {
      let release = () => {}
      pendingSave = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        pendingSave = null
        release()
      }
    },
    routes: [
      {
        method: 'GET',
        path: '/api/opencode/api/provider',
        respond: () => ({ json: { data: [makeCatalogProvider({ id: PROVIDER_ID, name: 'Anthropic' })] } }),
      },
      {
        method: 'GET',
        path: '/api/opencode/api/model',
        respond: () => ({ json: { data: [modelInfo] } }),
      },
      {
        method: 'GET',
        path: '/api/opencode/api/config',
        respond: () => ({
          json: configuredModel === null ? [] : [{ type: 'document', info: { model: configuredModel } }],
        }),
      },
      {
        method: 'GET',
        path: '/api/providers/model-state',
        respond: () => ({ json: state }),
      },
      {
        method: 'POST',
        path: '/api/providers/model-state',
        respond: async (request) => {
          if (pendingSave) await pendingSave
          if (savesFail) return { status: 500, json: { error: 'save failed' } }
          const body = saveBodySchema.safeParse(request.body)
          if (!body.success) return { status: 400, json: { error: 'bad body' } }
          const variant = body.data.variant
          if (variant) {
            const { providerID, modelID } = variant.model
            state = {
              ...state,
              variant: { ...state.variant, [`${providerID}/${modelID}`]: variant.value ?? undefined },
            }
          }
          return { json: state }
        },
      },
    ],
  }
}

function selectAgentModel(variant?: string): void {
  const model: ModelRef = { providerID: PROVIDER_ID, id: MODEL_ID }
  if (variant !== undefined) model.variant = variant
  useModelStore.getState().setActiveAgent({ id: AGENT_ID, model })
}

function renderVariants(server: ModelServer, session?: ModelSelectionSession) {
  return renderHookWithProviders(() => useVariants(DIRECTORY, session), {
    ...hookProviders,
    fetchRoutes: server.routes,
  })
}

function renderSectionVariants(server: ModelServer, session: ModelSelectionSession) {
  return renderHookWithProviders(
    () => ({ variants: useVariants(DIRECTORY, session), selection: useModelSelection(DIRECTORY, session) }),
    { ...hookProviders, fetchRoutes: server.routes },
  )
}

function savedVariant(fetchFake: FetchFake): string | null | undefined {
  const parsed = saveBodySchema.safeParse(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body)
  if (!parsed.success) return undefined
  return parsed.data.variant?.value ?? null
}

describe('useVariants', () => {
  let server: ModelServer

  beforeEach(() => {
    useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })
    server = modelServer()
  })

  it('uses the saved model.json variant when the selection has no variant', async () => {
    selectAgentModel()
    server.setState({ recent: [], favorite: [], variant: { [MODEL_KEY]: 'high' } })

    const { result } = renderVariants(server)

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('treats a saved default as no variant, beating the agent variant', async () => {
    selectAgentModel('high')
    server.setState({ recent: [], favorite: [], variant: { [MODEL_KEY]: 'default' } })

    const { result } = renderVariants(server)

    await waitFor(() => expect(result.current.hasVariants).toBe(true))
    expect(result.current.currentVariant).toBeUndefined()
  })

  it('falls back to the agent variant when nothing is saved', async () => {
    selectAgentModel('high')

    const { result } = renderVariants(server)

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('falls back to the configured variant when the agent has none', async () => {
    selectAgentModel()
    server.setConfiguredModel(`${MODEL_KEY}#low`)

    const { result } = renderVariants(server)

    await waitFor(() => expect(result.current.currentVariant).toBe('low'))
  })

  it('ignores a variant that is not in the model variants', async () => {
    selectAgentModel('turbo')

    const { result } = renderVariants(server)

    await waitFor(() => expect(result.current.hasVariants).toBe(true))
    expect(result.current.currentVariant).toBeUndefined()
  })

  it('uses the durable session variant over the saved preference', async () => {
    selectAgentModel()
    server.setState({ recent: [], favorite: [], variant: { [MODEL_KEY]: 'low' } })

    const { result } = renderVariants(server, {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID, variant: 'high' },
    })

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
  })

  it('stores a session variant on the session pick and persists it', async () => {
    selectAgentModel()
    const { result, fetchFake } = renderVariants(server, {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID },
    })

    await waitFor(() => expect(result.current.hasVariants).toBe(true))

    act(() => {
      result.current.setVariant('high')
    })

    expect(useModelStore.getState().sessionPicks.s1[AGENT_ID].variant).toBe('high')
    await waitFor(() => expect(savedVariant(fetchFake)).toBe('high'))

    act(() => {
      result.current.clearVariant()
    })

    expect(useModelStore.getState().sessionPicks.s1[AGENT_ID].variant).toBeUndefined()
    await waitFor(() => expect(savedVariant(fetchFake)).toBeNull())
  })

  it('persists the variant outside a session and drives the selection from the preference', async () => {
    selectAgentModel()
    const { result, fetchFake } = renderVariants(server)

    await waitFor(() => expect(result.current.hasVariants).toBe(true))

    act(() => {
      result.current.setVariant('high')
    })

    await waitFor(() => expect(result.current.currentVariant).toBe('high'))
    expect(useModelStore.getState().newSessionPicks).toEqual({})
    await waitFor(() => expect(savedVariant(fetchFake)).toBe('high'))

    act(() => {
      result.current.clearVariant()
    })

    await waitFor(() => expect(result.current.currentVariant).toBeUndefined())
  })

  it('cycles through named variants and wraps back to none', async () => {
    selectAgentModel()
    const { result } = renderVariants(server)

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
    server.setState({ recent: [], favorite: [], variant: { [MODEL_KEY]: 'low' } })
    const { result, queryClient } = renderVariants(server)

    await waitFor(() => expect(result.current.currentVariant).toBe('low'))

    server.failSaves()
    const release = server.deferSaves()
    act(() => {
      result.current.setVariant('high')
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<OpenCodeModelState>(modelStateQueryKey())?.variant).toEqual({
        [MODEL_KEY]: 'high',
      })
    })

    await act(async () => {
      release()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<OpenCodeModelState>(modelStateQueryKey())?.variant).toEqual({
        [MODEL_KEY]: 'low',
      })
    })
  })

  it('keeps the durable session variant after setModel records the same model as a recent', async () => {
    selectAgentModel()
    server.setState({
      recent: [{ providerID: PROVIDER_ID, modelID: MODEL_ID }],
      favorite: [],
      variant: { [MODEL_KEY]: 'low' },
    })

    const { result } = renderSectionVariants(server, {
      id: 's1',
      agent: AGENT_ID,
      model: { providerID: PROVIDER_ID, id: MODEL_ID, variant: 'high' },
    })

    await waitFor(() => expect(result.current.variants.currentVariant).toBe('high'))

    act(() => {
      result.current.selection.setModel({ providerID: PROVIDER_ID, modelID: MODEL_ID })
    })

    await waitFor(() => expect(result.current.variants.currentVariant).toBe('high'))
    expect(useModelStore.getState().sessionPicks.s1?.[AGENT_ID]).toBeUndefined()
  })

  describe('remote server', () => {
    const REMOTE_SERVER_ID = 'srv_remote'
    const REMOTE_PREFIX = `/api/opencode/servers/${REMOTE_SERVER_ID}`

    function renderRemoteVariants(options: { server: ModelServer; session?: ModelSelectionSession }) {
      const remoteRoutes = options.server.routes.map((route): FetchRoute => {
        if (route.path === '/api/opencode/api/provider' || route.path === '/api/opencode/api/model' || route.path === '/api/opencode/api/config') {
          return { ...route, path: `${REMOTE_PREFIX}${route.path.replace('/api/opencode', '')}` }
        }
        return route
      })
      return renderHookWithProviders(() => useVariants(DIRECTORY, options.session), {
        ...hookProviders,
        serverId: REMOTE_SERVER_ID,
        fetchRoutes: remoteRoutes,
      })
    }

    it('persists a remote session variant in the session pick and via saveOpenCodeModelVariant', async () => {
      selectAgentModel()
      const { result, fetchFake } = renderRemoteVariants({
        server,
        session: { id: 's1', agent: AGENT_ID, model: { providerID: PROVIDER_ID, id: MODEL_ID } },
      })

      await waitFor(() => expect(result.current.hasVariants).toBe(true))

      act(() => {
        result.current.setVariant('high')
      })

      expect(useModelStore.getState().sessionPicks.s1[AGENT_ID].variant).toBe('high')
      await waitFor(() => expect(result.current.currentVariant).toBe('high'))
      await waitFor(() => expect(savedVariant(fetchFake)).toBe('high'))
    })

    it('persists a remote variant outside a session and drives the selection from the preference', async () => {
      selectAgentModel()
      const { result, fetchFake } = renderRemoteVariants({ server })

      await waitFor(() => expect(result.current.hasVariants).toBe(true))

      act(() => {
        result.current.setVariant('high')
      })

      await waitFor(() => expect(result.current.currentVariant).toBe('high'))
      expect(useModelStore.getState().newSessionPicks).toEqual({})
      await waitFor(() => expect(savedVariant(fetchFake)).toBe('high'))
    })
  })
})
