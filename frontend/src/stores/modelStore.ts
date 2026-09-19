import { create } from 'zustand'
import type { Provider } from '@/api/providers'

export interface ModelSelection {
  providerID: string
  modelID: string
}

interface ModelStore {
  model: ModelSelection | null
  variants: Record<string, string | undefined>
  lastConfigModel: string | undefined

  setModel: (model: ModelSelection) => void
  setActiveModel: (model: ModelSelection) => void
  syncModelState: (state: { recent: ModelSelection[], favorite: ModelSelection[], variant: Record<string, string | undefined> }) => void
  syncFromConfig: (configModel: string | undefined, force?: boolean) => void
  validateAndSyncModel: (configModel: string | undefined, providers?: Provider[], recent?: ModelSelection[], fallbackModel?: string) => void
  getModelString: () => string | null
  setVariant: (model: ModelSelection, variant: string | undefined) => void
  getVariant: (model: ModelSelection) => string | undefined
  clearVariant: (model: ModelSelection) => void
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

if (typeof localStorage !== 'undefined') localStorage.removeItem('opencode-model-selection')

export const useModelStore = create<ModelStore>()((set, get) => ({
  model: null,
  variants: {},
  lastConfigModel: undefined,

  setModel: (model: ModelSelection) => {
    set({ model })
  },

  setActiveModel: (model: ModelSelection) => {
    set({ model })
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

  validateAndSyncModel: (configModel: string | undefined, providers?: Provider[], recent: ModelSelection[] = [], fallbackModel?: string) => {
    if (!providers) {
      if (configModel) {
        get().syncFromConfig(configModel)
      }
      return
    }

    const state = get()
    if (state.model && modelExists(state.model, providers)) return

    const parsedConfig = configModel ? parseModelString(configModel) : null
    if (parsedConfig && modelExists(parsedConfig, providers)) {
      get().syncFromConfig(configModel, true)
      return
    }

    const recentModel = recent.find((model) => modelExists(model, providers))
    if (recentModel) {
      set({ model: recentModel, lastConfigModel: configModel })
      return
    }

    const parsedFallback = fallbackModel ? parseModelString(fallbackModel) : null
    if (parsedFallback && modelExists(parsedFallback, providers)) {
      set({ model: parsedFallback, lastConfigModel: configModel })
      return
    }

    if (state.model === null && state.lastConfigModel === configModel) return
    set({ model: null, lastConfigModel: configModel })
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
}))
