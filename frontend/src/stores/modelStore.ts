import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Provider } from '@/api/providers'

export interface ModelSelection {
  providerID: string
  modelID: string
}

interface ModelStore {
  model: ModelSelection | null
  agentModels: Record<string, ModelSelection>
  variants: Record<string, string | undefined>
  lastConfigModel: string | undefined

  setModel: (model: ModelSelection) => void
  setActiveModel: (model: ModelSelection) => void
  setAgentModel: (agent: string, model: ModelSelection) => void
  getAgentModel: (agent: string) => ModelSelection | null
  syncModelState: (state: { recent: ModelSelection[], favorite: ModelSelection[], variant: Record<string, string | undefined> }) => void
  syncFromConfig: (configModel: string | undefined, force?: boolean) => void
  validateAndSyncModel: (configModel: string | undefined, providers?: Provider[]) => void
  getModelString: () => string | null
  setVariant: (model: ModelSelection, variant: string | undefined) => void
  getVariant: (model: ModelSelection) => string | undefined
  clearVariant: (model: ModelSelection) => void
}

export function formatModelKey(model: ModelSelection): string {
  return `${model.providerID}/${model.modelID}`
}

export function modelExists(model: ModelSelection | null, providers: Provider[]): boolean {
  if (!model) return false
  return providers.some(
    (p) => p.id === model.providerID && p.models && model.modelID in p.models
  )
}

function parseModelString(model: string): ModelSelection | null {
  const [providerID, ...rest] = model.split('/')
  const modelID = rest.join('/')
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export function modelStorePartialize(state: ModelStore): { model: ModelStore['model']; agentModels: ModelStore['agentModels'] } {
  return {
    model: state.model,
    agentModels: state.agentModels,
  }
}

function stripLegacyKeys(obj: Record<string, unknown>): void {
  delete obj.recentModels
  delete obj.favoriteModels
  delete obj.variants
}

export function modelStoreMigrate(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== 'object') return persistedState
  const next = { ...persistedState } as Record<string, unknown>
  stripLegacyKeys(next)
  if (next.state && typeof next.state === 'object' && !Array.isArray(next.state)) {
    const state = { ...(next.state as Record<string, unknown>) }
    stripLegacyKeys(state)
    next.state = state
  }
  return next
}

function mergeVariants(
  current: Record<string, string | undefined>,
  incoming: Record<string, string | undefined>
): Record<string, string | undefined> | undefined {
  const next = { ...incoming, ...current }
  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)

  if (currentKeys.length !== nextKeys.length) return next
  return nextKeys.some((key) => current[key] !== next[key]) ? next : undefined
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
    model: null,
    agentModels: {},
    variants: {},
    lastConfigModel: undefined,

    setModel: (model: ModelSelection) => {
      set({ model })
    },

    setActiveModel: (model: ModelSelection) => {
      set({ model })
    },

    setAgentModel: (agent: string, model: ModelSelection) => {
      set((state) => ({
        agentModels: {
          ...state.agentModels,
          [agent]: model,
        },
      }))
    },

    getAgentModel: (agent: string) => {
      const state = get()
      return state.agentModels[agent] ?? null
    },

    syncModelState: (modelState) => {
      const variants = mergeVariants(get().variants, modelState.variant)
      if (variants) {
        set({ variants })
      }
    },

    syncFromConfig: (configModel: string | undefined, force = false) => {
      const state = get()
      if (!force && state.lastConfigModel === configModel) return

      if (configModel) {
        const parsed = parseModelString(configModel)
        if (parsed) {
          set({ model: parsed, lastConfigModel: configModel })
          return
        }
      }
      set({ lastConfigModel: configModel })
    },

    validateAndSyncModel: (configModel: string | undefined, providers?: Provider[]) => {
      if (!providers) {
        if (configModel) {
          get().syncFromConfig(configModel)
        }
        return
      }

      const state = get()

      const currentModelExists = state.model ? modelExists(state.model, providers) : false

      if (!currentModelExists) {
        const parsedConfig = configModel ? parseModelString(configModel) : null
        const configIsValid = parsedConfig ? modelExists(parsedConfig, providers) : false

        if (configIsValid && configModel) {
          get().syncFromConfig(configModel, true)
        } else {
          set({ model: null, lastConfigModel: configModel })
        }
      }
    },

    getModelString: () => {
      const { model } = get()
      if (!model) return null
      return `${model.providerID}/${model.modelID}`
    },

    setVariant: (model: ModelSelection, variant: string | undefined) => {
      const key = `${model.providerID}/${model.modelID}`
      if (get().variants[key] === variant) return

      set((state) => {
        return {
          variants: {
            ...state.variants,
            [key]: variant,
          },
        }
      })
    },

    getVariant: (model: ModelSelection) => {
      const state = get()
      const key = `${model.providerID}/${model.modelID}`
      return state.variants[key]
    },

    clearVariant: (model: ModelSelection) => {
      const key = `${model.providerID}/${model.modelID}`
      if (!(key in get().variants)) return

      set((state) => {
        const newVariants = { ...state.variants }
        delete newVariants[key]
        return {
          variants: newVariants,
        }
      })
    },
    }),
    {
      name: 'opencode-model-selection',
      version: 2,
      migrate: modelStoreMigrate,
      partialize: modelStorePartialize,
    }
  )
)
