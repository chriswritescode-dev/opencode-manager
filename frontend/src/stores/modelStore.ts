import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ModelSelection {
  providerID: string
  modelID: string
}

interface ModelStore {
  model: ModelSelection | null
  recentModels: ModelSelection[]
  variants: Record<string, string | undefined>
  lastConfigModel: string | undefined

  setModel: (model: ModelSelection) => void
  syncFromConfig: (configModel: string | undefined) => void
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
      recentModels: [],
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

      syncFromConfig: (configModel: string | undefined) => {
        const state = get()
        if (state.lastConfigModel === configModel) return
        
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
        recentModels: state.recentModels,
        variants: state.variants,
      }),
    }
  )
)