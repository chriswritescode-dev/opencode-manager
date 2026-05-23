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
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  variants: Record<string, string | undefined>
  lastConfigModel: string | undefined

  setModel: (model: ModelSelection) => void
  setActiveModel: (model: ModelSelection) => void
  setAgentModel: (agent: string, model: ModelSelection) => void
  getAgentModel: (agent: string) => ModelSelection | null
  syncModelState: (state: { recent: ModelSelection[], favorite: ModelSelection[], variant: Record<string, string | undefined> }) => void
  toggleFavorite: (model: ModelSelection) => void
  syncFromConfig: (configModel: string | undefined, force?: boolean) => void
  validateAndSyncModel: (configModel: string | undefined, providers?: Provider[]) => void
  getModelString: () => string | null
  setVariant: (model: ModelSelection, variant: string | undefined) => void
  getVariant: (model: ModelSelection) => string | undefined
  clearVariant: (model: ModelSelection) => void
}

const MAX_RECENT_MODELS = 10

function parseModelString(model: string): ModelSelection | null {
  const [providerID, ...rest] = model.split('/')
  const modelID = rest.join('/')
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      model: null,
      agentModels: {},
      recentModels: [],
      favoriteModels: [],
      variants: {},
      lastConfigModel: undefined,

      setModel: (model: ModelSelection) => {
        set((state) => {
          const newRecent = [
            model,
            ...state.recentModels.filter(
              (m) => !(m.providerID === model.providerID && m.modelID === model.modelID)
            ),
          ].slice(0, MAX_RECENT_MODELS)

          return {
            model,
            recentModels: newRecent,
          }
        })
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
        set((state) => ({
          recentModels: modelState.recent,
          favoriteModels: modelState.favorite,
          variants: {
            ...modelState.variant,
            ...state.variants,
          },
        }))
      },

      toggleFavorite: (model: ModelSelection) => {
        set((state) => {
          const exists = state.favoriteModels.some(
            (favorite) => favorite.providerID === model.providerID && favorite.modelID === model.modelID
          )

          return {
            favoriteModels: exists
              ? state.favoriteModels.filter((favorite) => favorite.providerID !== model.providerID || favorite.modelID !== model.modelID)
              : [model, ...state.favoriteModels],
          }
        })
      },

      syncFromConfig: (configModel: string | undefined, force = false) => {
        const state = get()
        if (!force && state.lastConfigModel === configModel) return
        
        if (configModel) {
          const parsed = parseModelString(configModel)
          if (parsed) {
            const newRecent = [
              parsed,
              ...state.recentModels.filter(
                (m) => !(m.providerID === parsed.providerID && m.modelID === parsed.modelID)
              ),
            ].slice(0, MAX_RECENT_MODELS)
            
            set({ model: parsed, lastConfigModel: configModel, recentModels: newRecent })
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

        const modelExists = (model: ModelSelection) =>
          providers.some(
            (p) => p.id === model.providerID && p.models && model.modelID in p.models
          )

        const currentModelExists = state.model ? modelExists(state.model) : false

        const cleanedRecentModels = state.recentModels.filter(modelExists)
        const cleanedFavoriteModels = state.favoriteModels.filter(modelExists)

        if (cleanedRecentModels.length !== state.recentModels.length) {
          set({ recentModels: cleanedRecentModels })
        }

        if (cleanedFavoriteModels.length !== state.favoriteModels.length) {
          set({ favoriteModels: cleanedFavoriteModels })
        }

        if (!currentModelExists) {
          const parsedConfig = configModel ? parseModelString(configModel) : null
          const configIsValid = parsedConfig
            ? providers.some(p => p.id === parsedConfig.providerID && p.models && parsedConfig.modelID in p.models)
            : false

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
        set((state) => {
          const key = `${model.providerID}/${model.modelID}`
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
        set((state) => {
          const key = `${model.providerID}/${model.modelID}`
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
      partialize: (state) => ({
        model: state.model,
        agentModels: state.agentModels,
        recentModels: state.recentModels,
        favoriteModels: state.favoriteModels,
        variants: state.variants,
      }),
    }
  )
)
