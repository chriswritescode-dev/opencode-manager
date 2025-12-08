import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ModelSelection {
  providerID: string
  modelID: string
}

interface ModelStore {
  model: ModelSelection | null
  recentModels: ModelSelection[]
  isInitialized: boolean
  
  setModel: (model: ModelSelection) => void
  initializeFromConfig: (configModel: string | undefined) => void
  getModelString: () => string | null
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
      isInitialized: false,

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

      initializeFromConfig: (configModel: string | undefined) => {
        const state = get()
        if (state.isInitialized) return
        
        if (!state.model && configModel) {
          const parsed = parseModelString(configModel)
          if (parsed) {
            set({ model: parsed, isInitialized: true })
            return
          }
        }
        set({ isInitialized: true })
      },

      getModelString: () => {
        const { model } = get()
        if (!model) return null
        return `${model.providerID}/${model.modelID}`
      },
    }),
    {
      name: 'opencode-model-selection',
      partialize: (state) => ({
        model: state.model,
        recentModels: state.recentModels,
      }),
    }
  )
)
