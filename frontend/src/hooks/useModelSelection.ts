import { useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationAgentKey, useModelStore, type ActiveAgent, type ModelPick, type ModelSelection } from '@/stores/modelStore'
import { useProviders } from './useProviders'
import { isModelAvailable } from '@/lib/modelCatalog'
import {
  addOpenCodeRecentModel,
  getOpenCodeConfiguredModel,
  getOpenCodeModelState,
  getOpenCodeServerDefaultModel,
  modelSelectionRef,
  removeOpenCodeRecentModel,
  toggleOpenCodeFavoriteModel,
  type OpenCodeModelState,
} from '@/api/providers'
import {
  addRecentModel,
  findModelInfo,
  formatOpenCodeModelRef,
  isSameModelSelection,
  modelPreferenceKey,
  normalizeModelVariant,
  parseOpenCodeModelRef,
  removeRecentModel,
  selectEffectiveModelRef,
  selectInteractiveModel,
  selectPreferredVariant,
  toggleFavoriteModel,
  type ModelInfo,
  type ModelRef,
} from '@opencode-manager/shared/opencode'

export interface ModelSelectionSession {
  id: string
  agent?: string
  model?: ModelRef
}

interface UseModelSelectionResult {
  model: ModelSelection | null
  selection: ModelPick | null
  info: ModelInfo | undefined
  modelString: string | null
  modelRef: ModelRef | null
  activeAgent: ActiveAgent | null
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  configured: ModelRef | null
  modelState: OpenCodeModelState | undefined
  isModelReady: boolean
  setModel: (model: ModelSelection) => void
  setActiveAgent: (agent: ActiveAgent) => void
  toggleFavorite: (model: ModelSelection) => void
  removeRecentModel: (model: ModelSelection) => void
}

export function modelStateQueryKey() {
  return ['opencode', 'model-state'] as const
}

export function useOpenCodeModelState(_directory?: string, enabled = true) {
  return useQuery({
    queryKey: modelStateQueryKey(),
    queryFn: () => getOpenCodeModelState(),
    staleTime: 30000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

function useOpenCodeConfiguredModel(directory?: string, enabled = true) {
  return useQuery({
    queryKey: ['opencode', 'config', 'model', directory],
    queryFn: () => getOpenCodeConfiguredModel(directory),
    staleTime: 30000,
    enabled,
  })
}

export function useOpenCodeDefaultModel(directory?: string, enabled = true) {
  const providersQuery = useProviders(directory, { enabled })
  const configuredQuery = useOpenCodeConfiguredModel(directory, enabled)
  const defaultQuery = useQuery({
    queryKey: ['opencode', 'providers', 'default-model', directory],
    queryFn: () => getOpenCodeServerDefaultModel(directory),
    staleTime: 30000,
    enabled,
  })

  const data = useMemo(() => {
    if (
      !providersQuery.data ||
      providersQuery.isPlaceholderData ||
      configuredQuery.data === undefined ||
      defaultQuery.data === undefined
    ) {
      return undefined
    }
    const configured = configuredQuery.data ? parseOpenCodeModelRef(configuredQuery.data) : undefined
    const resolved = selectEffectiveModelRef({
      models: providersQuery.data.models,
      defaultModel: defaultQuery.data,
      candidates: [configured],
    })
    return resolved ? formatOpenCodeModelRef(resolved) : null
  }, [providersQuery.data, providersQuery.isPlaceholderData, configuredQuery.data, defaultQuery.data])

  return {
    data,
    isLoading: providersQuery.isLoading || configuredQuery.isLoading || defaultQuery.isLoading,
  }
}

export function useModelStateMutation<TInput>(
  fetcher: (input: TInput) => Promise<OpenCodeModelState>,
  applyOptimistic: (state: OpenCodeModelState, input: TInput) => OpenCodeModelState,
  errorMessage: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: fetcher,
    onMutate: async (input) => {
      const queryKey = modelStateQueryKey()
      await queryClient.cancelQueries({ queryKey })
      const previousState = queryClient.getQueryData<OpenCodeModelState>(queryKey)
      if (previousState) queryClient.setQueryData(queryKey, applyOptimistic(previousState, input))
      return { previousState }
    },
    onSuccess: (state) => {
      queryClient.setQueryData(modelStateQueryKey(), state)
    },
    onError: (error, _input, context) => {
      if (context?.previousState) {
        queryClient.setQueryData(modelStateQueryKey(), context.previousState)
      }
      console.error(errorMessage, error)
    },
  })
}

interface PreferredSelectionContext {
  models: ModelInfo[]
  agentModel?: ModelRef
  configured: ModelRef | null
  preferences?: Record<string, string | undefined>
}

function preferredSelection(context: PreferredSelectionContext, model: ModelSelection): ModelPick {
  return {
    ...model,
    variant: selectPreferredVariant({
      model,
      info: findModelInfo(context.models, model),
      preferences: context.preferences,
      agentModel: context.agentModel,
      configured: context.configured,
    }),
  }
}

interface ResolveSelectionInput extends PreferredSelectionContext {
  agentID?: string
  newSessionPick?: ModelPick
  sessionPicks?: Record<string, ModelPick | undefined>
  session?: ModelSelectionSession
  recent: ModelSelection[]
}

function resolveSelection(input: ResolveSelectionInput): ModelPick | undefined {
  const { models, session } = input

  if (session) {
    const sessionPick = input.agentID ? input.sessionPicks?.[input.agentID] : undefined
    const durable: ModelPick | undefined = session.model
      ? {
          providerID: session.model.providerID,
          modelID: session.model.id,
          variant: normalizeModelVariant(session.model.variant),
        }
      : undefined
    const durableUsable = !session.agent || session.agent === input.agentID
    const selected = [sessionPick, durableUsable ? durable : undefined].find(
      (candidate): candidate is ModelPick =>
        candidate !== undefined && findModelInfo(models, candidate) !== undefined,
    )
    if (selected) {
      const info = findModelInfo(models, selected)
      const variant = normalizeModelVariant(selected.variant)
      return {
        providerID: selected.providerID,
        modelID: selected.modelID,
        variant: info?.variants.some((entry) => entry.id === variant) ? variant : undefined,
      }
    }
  }

  const model = selectInteractiveModel({
    models,
    current: input.newSessionPick,
    agentModel: input.agentModel,
    configured: input.configured,
    recent: input.recent,
  })
  return model ? preferredSelection(input, model) : undefined
}

function selectionKey(value: ModelPick): string {
  return `${modelPreferenceKey(value)}:${normalizeModelVariant(value.variant) ?? 'default'}`
}

export function useModelSelection(
  directory?: string,
  session?: ModelSelectionSession,
): UseModelSelectionResult {
  const { data: catalog, isPlaceholderData: catalogIsPlaceholder } = useProviders(directory)

  const activeAgent = useModelStore((state) => state.activeAgent)
  const newSessionPicks = useModelStore((state) => state.newSessionPicks)
  const sessionPicks = useModelStore((state) => state.sessionPicks)
  const setNewSessionPick = useModelStore((state) => state.setNewSessionPick)
  const setSessionPick = useModelStore((state) => state.setSessionPick)
  const setActiveAgent = useModelStore((state) => state.setActiveAgent)

  const { data: modelState } = useOpenCodeModelState()
  const { data: configModelString } = useOpenCodeConfiguredModel(directory)

  const isModelReady = Boolean(
    catalog &&
      !catalogIsPlaceholder &&
      modelState !== undefined &&
      configModelString !== undefined,
  )

  const recentModels = useMemo(() => {
    const raw = modelState?.recent ?? []
    if (!catalog || catalog.models.length === 0) return raw
    return raw.filter((model) => isModelAvailable(catalog.models, model))
  }, [modelState?.recent, catalog])

  const favoriteModels = useMemo(() => {
    const raw = modelState?.favorite ?? []
    if (!catalog || catalog.models.length === 0) return raw
    return raw.filter((model) => isModelAvailable(catalog.models, model))
  }, [modelState?.favorite, catalog])

  const configured = useMemo(
    () => (configModelString ? parseOpenCodeModelRef(configModelString) ?? null : null),
    [configModelString],
  )

  const key = locationAgentKey(directory, activeAgent?.id)

  const selection = useMemo(() => {
    if (!isModelReady || !catalog) return null
    return (
      resolveSelection({
        models: catalog.models,
        agentID: activeAgent?.id,
        agentModel: activeAgent?.model,
        newSessionPick: newSessionPicks[key],
        sessionPicks: session?.id ? sessionPicks[session.id] : undefined,
        session,
        configured,
        recent: modelState?.recent ?? [],
        preferences: modelState?.variant,
      }) ?? null
    )
  }, [
    activeAgent?.id,
    activeAgent?.model,
    catalog,
    configured,
    isModelReady,
    key,
    modelState?.recent,
    modelState?.variant,
    newSessionPicks,
    session,
    sessionPicks,
  ])

  const info = useMemo(
    () => (selection ? findModelInfo(catalog?.models ?? [], selection) : undefined),
    [catalog, selection],
  )

  const model = selection
    ? { providerID: selection.providerID, modelID: selection.modelID }
    : null

  const updateRecentModel = useModelStateMutation(
    addOpenCodeRecentModel,
    (state, nextModel) => addRecentModel(state, nextModel),
    'Failed to sync recent model to backend',
  )

  const updateFavoriteModel = useModelStateMutation(
    toggleOpenCodeFavoriteModel,
    (state, nextModel) => toggleFavoriteModel(state, nextModel),
    'Failed to toggle favorite model on backend',
  )

  const removeRecentMutation = useModelStateMutation(
    removeOpenCodeRecentModel,
    (state, nextModel) => removeRecentModel(state, nextModel),
    'Failed to remove recent model on backend',
  )

  const preferred = (target: ModelSelection): ModelPick => {
    if (!catalog) return { ...target }
    return preferredSelection(
      {
        models: catalog.models,
        agentModel: activeAgent?.model,
        configured,
        preferences: modelState?.variant,
      },
      target,
    )
  }

  const setSessionDraft = (agentID: string, next: ModelPick) => {
    if (!session) return
    const durable: ModelPick | undefined = session.model
      ? {
          providerID: session.model.providerID,
          modelID: session.model.id,
          variant: normalizeModelVariant(session.model.variant),
        }
      : undefined
    const durableUsable = !session.agent || session.agent === agentID
    const drop = Boolean(durableUsable && durable && selectionKey(durable) === selectionKey(next))
    setSessionPick(session.id, agentID, drop ? undefined : next)
  }

  const setModel = (nextModel: ModelSelection) => {
    if (session?.id && activeAgent?.id) {
      const next = selection && isSameModelSelection(selection, nextModel)
        ? { ...selection }
        : preferred(nextModel)
      setSessionDraft(activeAgent.id, next)
    } else {
      setNewSessionPick(key, nextModel)
    }
    updateRecentModel.mutate(nextModel)
  }

  const toggleFavorite = (nextModel: ModelSelection) => {
    updateFavoriteModel.mutate(nextModel)
  }

  const removeRecent = (nextModel: ModelSelection) => {
    removeRecentMutation.mutate(nextModel)
  }

  return {
    model,
    selection,
    info,
    modelString: model ? modelSelectionRef(model) : null,
    modelRef: selection
      ? {
          providerID: selection.providerID,
          id: selection.modelID,
          ...(selection.variant ? { variant: selection.variant } : {}),
        }
      : null,
    activeAgent,
    recentModels,
    favoriteModels,
    configured,
    modelState,
    isModelReady,
    setModel,
    setActiveAgent,
    toggleFavorite,
    removeRecentModel: removeRecent,
  }
}
