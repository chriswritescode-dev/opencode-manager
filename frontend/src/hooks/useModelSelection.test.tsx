import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import type { QueryClient } from '@tanstack/react-query'
import { modelStateQueryKey, useModelSelection, useOpenCodeDefaultModel } from './useModelSelection'
import { useProviders } from './useProviders'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import { createTestQueryClient, renderHookWithProviders } from '@/test/render'
import type { TestProviderOptions } from '@/test/render'
import { makeCatalogModel, makeCatalogProvider } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeModelState } from '@/api/providers'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const EMPTY_STATE: OpenCodeModelState = { recent: [], favorite: [], variant: {} }

const anthropicProvider = makeCatalogProvider({ id: 'anthropic', name: 'Anthropic' })
const openaiProvider = makeCatalogProvider({ id: 'openai', name: 'OpenAI' })

function model(providerID: string, id: string, variants: string[] = []): ModelInfo {
  return makeCatalogModel({
    providerID,
    id,
    modelID: id,
    name: id,
    variants: variants.map((variant) => ({ id: variant })),
  })
}

const claudeModel = model('anthropic', 'claude-sonnet-4', ['high', 'low'])
const gptModel = model('openai', 'gpt-4o')

const modelPickSchema = z.object({ providerID: z.string(), modelID: z.string() })

const modelStateBodySchema = z.object({
  recent: modelPickSchema.optional(),
  removeRecent: modelPickSchema.optional(),
  favorite: modelPickSchema.optional(),
  variant: z.object({ model: modelPickSchema, value: z.string().nullable() }).optional(),
})

interface CatalogOptions {
  providers: CatalogProviderInfo[]
  models: ModelInfo[]
  configured?: string
  serverDefault?: { providerID: string, id: string } | null
  prefix?: string
}

function catalogRoutes(options: CatalogOptions): FetchRoute[] {
  const prefix = options.prefix ?? '/api/opencode/api'
  return [
    {
      method: 'GET',
      path: `${prefix}/provider`,
      respond: () => ({ json: { data: options.providers } }),
    },
    {
      method: 'GET',
      path: `${prefix}/model`,
      respond: () => ({ json: { data: options.models } }),
    },
    {
      method: 'GET',
      path: `${prefix}/config`,
      respond: () => ({
        json: options.configured === undefined ? [] : [{ type: 'document', info: { model: options.configured } }],
      }),
    },
    {
      method: 'GET',
      path: `${prefix}/model/default`,
      respond: () => ({ json: { data: options.serverDefault ?? null } }),
    },
  ]
}

interface ModelStateServer {
  routes: FetchRoute[]
  state: () => OpenCodeModelState
}

function modelStateServer(initial: OpenCodeModelState = EMPTY_STATE): ModelStateServer {
  let state = initial
  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/providers/model-state',
      respond: () => ({ json: state }),
    },
    {
      method: 'POST',
      path: '/api/providers/model-state',
      respond: (request) => {
        const body = modelStateBodySchema.parse(request.body)
        const next = { ...state }
        if (body.recent) next.recent = [body.recent, ...next.recent.filter(
          (entry) => entry.providerID !== body.recent?.providerID || entry.modelID !== body.recent?.modelID,
        )]
        if (body.removeRecent) next.recent = next.recent.filter(
          (entry) => entry.providerID !== body.removeRecent?.providerID || entry.modelID !== body.removeRecent?.modelID,
        )
        if (body.favorite) {
          const exists = next.favorite.some(
            (entry) => entry.providerID === body.favorite?.providerID && entry.modelID === body.favorite?.modelID,
          )
          next.favorite = exists
            ? next.favorite.filter(
              (entry) => entry.providerID !== body.favorite?.providerID || entry.modelID !== body.favorite?.modelID,
            )
            : [body.favorite, ...next.favorite]
        }
        if (body.variant) {
          next.variant = {
            ...next.variant,
            [`${body.variant.model.providerID}/${body.variant.model.modelID}`]: body.variant.value ?? undefined,
          }
        }
        state = next
        return { json: state }
      },
    },
  ]
  return { routes, state: () => state }
}

interface RenderModelSelectionOptions {
  directory?: string
  session?: { id: string, agent?: string, model?: { providerID: string, id: string, variant?: string } }
  serverId?: string
  routes: FetchRoute[]
  queryClient?: QueryClient
}

function renderModelSelection(options: RenderModelSelectionOptions) {
  const directory = options.directory ?? '/test'
  const providerOptions: TestProviderOptions = { ...hookProviders, fetchRoutes: options.routes }
  if (options.serverId !== undefined) providerOptions.serverId = options.serverId
  if (options.queryClient !== undefined) providerOptions.queryClient = options.queryClient
  return renderHookWithProviders(() => useModelSelection(directory, options.session), providerOptions)
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (cause: Error) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useModelSelection', () => {
  beforeEach(() => {
    useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })
  })

  describe('new-session selection order', () => {
    const catalog = (configured?: string): FetchRoute[] => {
      const options: CatalogOptions = {
        providers: [anthropicProvider, openaiProvider],
        models: [claudeModel, gptModel],
      }
      if (configured !== undefined) options.configured = configured
      return catalogRoutes(options)
    }

    it('prefers the active agent model over the configured model', async () => {
      useModelStore.getState().setActiveAgent({
        id: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })
      const server = modelStateServer()

      const { result } = renderModelSelection({
        routes: [...catalog('openai/gpt-4o'), ...server.routes],
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('prefers the configured model over the recent list', async () => {
      useModelStore.getState().setActiveAgent({ id: 'build' })
      const server = modelStateServer({ ...EMPTY_STATE, recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }] })

      const { result } = renderModelSelection({
        routes: [...catalog('openai/gpt-4o'), ...server.routes],
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('uses the first valid recent and skips an invalid one', async () => {
      useModelStore.getState().setActiveAgent({ id: 'build' })
      const server = modelStateServer({
        ...EMPTY_STATE,
        recent: [{ providerID: 'ghost', modelID: 'gone' }, { providerID: 'openai', modelID: 'gpt-4o' }],
      })

      const { result } = renderModelSelection({ routes: [...catalog(), ...server.routes] })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('falls back to the first catalog model', async () => {
      useModelStore.getState().setActiveAgent({ id: 'build' })
      const server = modelStateServer()

      const { result } = renderModelSelection({ routes: [...catalog(), ...server.routes] })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('remembers a user pick per directory and agent', async () => {
      const server = modelStateServer()

      const { result } = renderModelSelection({ routes: [...catalog(), ...server.routes] })

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

      expect(Object.keys(useModelStore.getState().newSessionPicks)).toHaveLength(1)
      const pickKey = Object.keys(useModelStore.getState().newSessionPicks)[0]
      const [, pickedAgentID] = z.tuple([z.string(), z.string()]).parse(parseJsonText(pickKey))
      expect(pickedAgentID).toBe('a')

      act(() => {
        result.current.setActiveAgent({ id: 'b' })
      })

      await waitFor(() => {
        expect(result.current.activeAgent?.id).toBe('b')
      })
      expect(Object.keys(useModelStore.getState().newSessionPicks)).toHaveLength(1)

      act(() => {
        result.current.setActiveAgent({ id: 'a' })
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('returns null when the catalog is not loaded', () => {
      const server = modelStateServer()

      const { result } = renderModelSelection({
        routes: [
          ...catalog().filter((route) => route.path !== '/api/opencode/api/provider'),
          { method: 'GET', path: '/api/opencode/api/provider', respond: () => new Promise(() => {}) },
          ...server.routes,
        ],
      })

      expect(result.current.model).toBeNull()
    })

    it('does not record a recent when the active agent changes', async () => {
      const server = modelStateServer()

      const { result, fetchFake } = renderModelSelection({ routes: [...catalog(), ...server.routes] })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setActiveAgent({ id: 'a', model: { providerID: 'openai', id: 'gpt-4o' } })
      })
      act(() => {
        result.current.setActiveAgent({ id: 'b' })
      })

      expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(0)
    })
  })

  describe('readiness', () => {
    const catalog = (): FetchRoute[] =>
      catalogRoutes({ providers: [anthropicProvider], models: [claudeModel] })

    it('is not ready and returns null while the model state loads', () => {
      const { result } = renderModelSelection({
        routes: [
          ...catalog(),
          { method: 'GET', path: '/api/providers/model-state', respond: () => new Promise(() => {}) },
        ],
      })

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()
    })

    it('is not ready and returns null while the configured model loads', () => {
      const server = modelStateServer()
      const { result } = renderModelSelection({
        routes: [
          ...catalog().filter((route) => route.path !== '/api/opencode/api/config'),
          { method: 'GET', path: '/api/opencode/api/config', respond: () => new Promise(() => {}) },
          ...server.routes,
        ],
      })

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()
    })

    it('returns null while a directory switch serves placeholder catalog data', async () => {
      const pendingCatalogB = deferred<FetchRouteResult>()
      const server = modelStateServer()
      let directory = '/a'
      const { result, rerender } = renderHookWithProviders(
        () => useModelSelection(directory),
        {
          ...hookProviders,
          fetchRoutes: [
            {
              method: 'GET',
              path: '/api/opencode/api/provider',
              respond: () => (directory === '/b' ? pendingCatalogB.promise : { json: { data: [anthropicProvider] } }),
            },
            {
              method: 'GET',
              path: '/api/opencode/api/model',
              respond: () => ({ json: { data: directory === '/b' ? [gptModel] : [claudeModel] } }),
            },
            ...catalogRoutes({ providers: [], models: [] }).filter(
              (route) => route.path !== '/api/opencode/api/provider' && route.path !== '/api/opencode/api/model',
            ),
            ...server.routes,
          ],
        },
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })

      directory = '/b'
      rerender()

      expect(result.current.isModelReady).toBe(false)
      expect(result.current.model).toBeNull()

      await act(async () => {
        pendingCatalogB.resolve({ status: 200, json: { data: [openaiProvider] } })
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })
  })

  describe('session selection', () => {
    const sessionCatalog = (): FetchRoute[] =>
      catalogRoutes({
        providers: [anthropicProvider, openaiProvider],
        models: [claudeModel, gptModel],
      })

    const renderSession = (session: {
      id: string
      agent?: string
      model?: { providerID: string, id: string, variant?: string }
    }, routes: FetchRoute[]) => renderModelSelection({ session, routes })

    beforeEach(() => {
      useModelStore.getState().setActiveAgent({ id: 'build' })
    })

    it('uses the durable session model with its variant', async () => {
      const server = modelStateServer()
      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4', variant: 'high' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.selection).toEqual({
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4',
          variant: 'high',
        })
      })
    })

    it('does not write to the store when viewing a session', async () => {
      const server = modelStateServer()
      const { result, fetchFake } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      expect(useModelStore.getState().sessionPicks).toEqual({})
      expect(useModelStore.getState().newSessionPicks).toEqual({})
      expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(0)
    })

    it('prefers a session pick over the durable selection', async () => {
      useModelStore.getState().setSessionPick('s1', 'build', { providerID: 'openai', modelID: 'gpt-4o' })
      const server = modelStateServer()

      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
    })

    it('ignores the durable selection when the session agent differs from the active agent', async () => {
      useModelStore.getState().setActiveAgent({ id: 'plan' })
      const server = modelStateServer()

      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })

    it('treats a default session variant as no variant without saved-preference fallback', async () => {
      const server = modelStateServer({
        ...EMPTY_STATE,
        variant: { 'anthropic/claude-sonnet-4': 'high' },
      })

      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4', variant: 'default' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
      expect(result.current.selection?.variant).toBeUndefined()
    })

    it('drops the session variant when the model does not declare it', async () => {
      const server = modelStateServer()
      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'openai', id: 'gpt-4o', variant: 'high' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
      expect(result.current.selection?.variant).toBeUndefined()
    })

    it('stores an explicit pick for the session agent', async () => {
      const server = modelStateServer()
      const { result, fetchFake } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

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
      await waitFor(() => expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(1))
    })

    it('drops the session draft when the pick equals the durable selection', async () => {
      const server = modelStateServer()
      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setModel({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })

      expect(useModelStore.getState().sessionPicks['s1']?.build).toBeUndefined()
    })

    it('does not mutate picks when the active agent switches inside a session', async () => {
      const server = modelStateServer()
      const { result } = renderSession(
        { id: 's1', agent: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } },
        [...sessionCatalog(), ...server.routes],
      )

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

  describe('remote server scoping', () => {
    const REMOTE_SERVER_ID = 'srv_remote'
    const REMOTE_PREFIX = `/api/opencode/servers/${REMOTE_SERVER_ID}/api`

    const remoteCatalog = (configured?: string): FetchRoute[] => {
      const options: CatalogOptions = {
        providers: [anthropicProvider, openaiProvider],
        models: [claudeModel, gptModel],
        prefix: REMOTE_PREFIX,
      }
      if (configured !== undefined) options.configured = configured
      return catalogRoutes(options)
    }

    beforeEach(() => {
      useModelStore.getState().setActiveAgent({ id: 'build' })
    })

    it('keys new-session picks by the remote server and directory', async () => {
      const server = modelStateServer()
      const { result } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: [...remoteCatalog(), ...server.routes],
      })

      await waitFor(() => {
        expect(result.current.model).not.toBeNull()
      })

      act(() => {
        result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
      })

      const picks = useModelStore.getState().newSessionPicks
      expect(Object.values(picks).map((pick) => pick)).toEqual([{ providerID: 'openai', modelID: 'gpt-4o' }])
      expect(Object.keys(picks)).toHaveLength(1)
      expect(Object.keys(picks)[0]).toContain(`${REMOTE_SERVER_ID}|/test`)
    })

    it('reads the shared model state and writes favorites and recents on a remote server', async () => {
      const server = modelStateServer({
        recent: [{ providerID: 'openai', modelID: 'gpt-4o' }, { providerID: 'ghost', modelID: 'gone' }],
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }, { providerID: 'ghost', modelID: 'gone' }],
        variant: {},
      })
      const { result, fetchFake } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: [...remoteCatalog(), ...server.routes],
      })

      await waitFor(() => expect(result.current.isModelReady).toBe(true))
      expect(fetchFake.findRequests('GET', '/api/providers/model-state')).toHaveLength(1)
      await waitFor(() => expect(result.current.recentModels).toEqual([{ providerID: 'openai', modelID: 'gpt-4o' }]))
      await waitFor(() =>
        expect(result.current.favoriteModels).toEqual([{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }]),
      )

      act(() => {
        result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
        result.current.toggleFavorite({ providerID: 'openai', modelID: 'gpt-4o' })
        result.current.removeRecentModel({ providerID: 'openai', modelID: 'gpt-4o' })
      })

      await waitFor(() => expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(3))
      expect(fetchFake.findRequests('POST', '/api/providers/model-state').map((request) => request.body)).toEqual([
        { recent: { providerID: 'openai', modelID: 'gpt-4o' } },
        { favorite: { providerID: 'openai', modelID: 'gpt-4o' } },
        { removeRecent: { providerID: 'openai', modelID: 'gpt-4o' } },
      ])
    })

    it('reads the model state a local server populated from the same cache entry', async () => {
      const queryClient = createTestQueryClient()
      queryClient.setQueryData(modelStateQueryKey(), {
        recent: [{ providerID: 'openai', modelID: 'gpt-4o' }],
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
        variant: {},
      })

      const { result, fetchFake } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: remoteCatalog(),
        queryClient,
      })

      await waitFor(() =>
        expect(result.current.recentModels).toEqual([{ providerID: 'openai', modelID: 'gpt-4o' }]),
      )
      expect(result.current.favoriteModels).toEqual([{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }])
      expect(fetchFake.findRequests('GET', '/api/providers/model-state')).toHaveLength(0)
    })

    it('stays ready with empty preferences when the model state fails to load', async () => {
      const { result } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: [
          ...remoteCatalog(),
          {
            method: 'GET',
            path: '/api/providers/model-state',
            respond: () => ({ status: 500, json: { error: 'offline' } }),
          },
        ],
      })

      await waitFor(() => expect(result.current.isModelReady).toBe(true))
      expect(result.current.favoriteModels).toEqual([])
      expect(result.current.model).not.toBeNull()
    })

    it('uses the shared recents in the selection order', async () => {
      const server = modelStateServer({ ...EMPTY_STATE, recent: [{ providerID: 'openai', modelID: 'gpt-4o' }] })
      const { result } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: [...remoteCatalog(), ...server.routes],
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
      })
      expect(result.current.recentModels).toEqual([{ providerID: 'openai', modelID: 'gpt-4o' }])
    })

    it('keeps the agent model ahead of the configured model', async () => {
      useModelStore.getState().setActiveAgent({
        id: 'build',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      })
      const server = modelStateServer()

      const { result } = renderModelSelection({
        serverId: REMOTE_SERVER_ID,
        routes: [...remoteCatalog('openai/gpt-4o'), ...server.routes],
      })

      await waitFor(() => {
        expect(result.current.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
      })
    })
  })

  it('records a recent on setModel', async () => {
    const server = modelStateServer()
    const { result, fetchFake } = renderModelSelection({
      routes: [
        ...catalogRoutes({ providers: [], models: [] }),
        ...server.routes,
      ],
    })

    await waitFor(() => expect(result.current.isModelReady).toBe(true))

    act(() => {
      result.current.setModel({ providerID: 'openai', modelID: 'gpt-4o' })
    })

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(1))
    expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({
      recent: { providerID: 'openai', modelID: 'gpt-4o' },
    })
  })

  describe('recentModels/favoriteModels derived from React Query', () => {
    it('filters out models not present in providers', async () => {
      const server = modelStateServer({
        recent: [{ providerID: 'AI2', modelID: 'foo' }, { providerID: 'GreatScott', modelID: 'mimo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }, { providerID: 'GreatScott', modelID: 'mimo' }],
        variant: {},
      })
      const { result } = renderModelSelection({
        routes: [
          ...catalogRoutes({
            providers: [makeCatalogProvider({ id: 'AI2', name: 'AI2' }), makeCatalogProvider({ id: 'VLLM', name: 'VLLM' })],
            models: [model('AI2', 'foo'), model('VLLM', 'bar')],
          }),
          ...server.routes,
        ],
      })

      await waitFor(() => expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }]))
      await waitFor(() => expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }]))
    })

    it('returns raw values when providers query is loading', async () => {
      const server = modelStateServer({
        ...EMPTY_STATE,
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
      })
      const { result } = renderModelSelection({
        routes: [
          { method: 'GET', path: '/api/opencode/api/provider', respond: () => new Promise(() => {}) },
          ...server.routes,
        ],
      })

      await waitFor(() => expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }]))
      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })

    it('returns raw values when providers returns empty array', async () => {
      const server = modelStateServer({
        ...EMPTY_STATE,
        recent: [{ providerID: 'AI2', modelID: 'foo' }],
        favorite: [{ providerID: 'VLLM', modelID: 'bar' }],
      })
      const { result } = renderModelSelection({
        routes: [...catalogRoutes({ providers: [], models: [] }), ...server.routes],
      })

      await waitFor(() => expect(result.current.recentModels).toEqual([{ providerID: 'AI2', modelID: 'foo' }]))
      expect(result.current.favoriteModels).toEqual([{ providerID: 'VLLM', modelID: 'bar' }])
    })
  })

  it('toggleFavorite writes the favorite and does not mutate the store', async () => {
    const server = modelStateServer()
    const { result, fetchFake } = renderModelSelection({ routes: [...catalogRoutes({ providers: [], models: [] }), ...server.routes] })
    await waitFor(() => expect(result.current.isModelReady).toBe(true))

    const testModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    act(() => {
      result.current.toggleFavorite(testModel)
    })

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/providers/model-state')).toHaveLength(1))
    expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({ favorite: testModel })
    expect(useModelStore.getState().newSessionPicks).toEqual({})
  })

  it('removes recent models optimistically and rolls back on failure', async () => {
    const removedModel: ModelSelection = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    const retainedModel: ModelSelection = { providerID: 'openai', modelID: 'gpt-4.1' }
    const pending = deferred<FetchRouteResult>()
    const server = modelStateServer({ ...EMPTY_STATE, recent: [removedModel, retainedModel] })

    const { result } = renderModelSelection({
      routes: [
        ...catalogRoutes({ providers: [], models: [] }),
        server.routes[0],
        {
          method: 'POST',
          path: '/api/providers/model-state',
          respond: () => pending.promise,
        },
      ],
    })

    await waitFor(() => expect(result.current.recentModels).toEqual([removedModel, retainedModel]))

    act(() => {
      result.current.removeRecentModel(removedModel)
    })

    await waitFor(() => expect(result.current.recentModels).toEqual([retainedModel]))

    await act(async () => {
      pending.reject(new Error('remove failed'))
    })

    await waitFor(() => expect(result.current.recentModels).toEqual([removedModel, retainedModel]))
  })
})

describe('useOpenCodeDefaultModel', () => {
  const renderDefaultModel = (routes: FetchRoute[]) =>
    renderHookWithProviders(
      () => {
        const directory = '/test'
        return { providers: useProviders(directory), defaultModel: useOpenCodeDefaultModel(directory) }
      },
      { ...hookProviders, fetchRoutes: routes },
    )

  it('prefers a configured model that is listed, with its variant', async () => {
    const { result } = renderDefaultModel(
      catalogRoutes({
        providers: [anthropicProvider],
        models: [claudeModel],
        configured: 'anthropic/claude-sonnet-4#thinking',
      }),
    )

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('anthropic/claude-sonnet-4#thinking')
    })
  })

  it('falls back to the server default when the configured model is not listed', async () => {
    const { result } = renderDefaultModel(
      catalogRoutes({
        providers: [openaiProvider],
        models: [gptModel],
        configured: 'openai/retired',
        serverDefault: { providerID: 'openai', id: 'gpt-4o' },
      }),
    )

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('openai/gpt-4o')
    })
  })

  it('falls back to the first enabled model when neither is available', async () => {
    const { result } = renderDefaultModel(
      catalogRoutes({ providers: [anthropicProvider], models: [claudeModel] }),
    )

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBe('anthropic/claude-sonnet-4')
    })
  })

  it('fetches the catalog once when both hooks are mounted for the same directory', async () => {
    const { result, fetchFake } = renderDefaultModel(
      catalogRoutes({ providers: [anthropicProvider], models: [claudeModel] }),
    )

    await waitFor(() => {
      expect(result.current.defaultModel.data).toBeDefined()
    })
    expect(fetchFake.findRequests('GET', '/api/opencode/api/provider')).toHaveLength(1)
    expect(fetchFake.findRequests('GET', '/api/opencode/api/model')).toHaveLength(1)
  })
})
