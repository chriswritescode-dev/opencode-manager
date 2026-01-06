import { apiClient, API_BASE_URL } from '@/lib/api'

export interface TTSModelsResponse {
  models: string[]
  cached: boolean
}

export interface TTSVoicesResponse {
  voices: string[]
  cached: boolean
}

export interface TTSStatusResponse {
  enabled: boolean
  configured: boolean
  cache: {
    count: number
    sizeBytes: number
    sizeMB: number
    maxSizeMB: number
    ttlHours: number
  }
}

export const ttsApi = {
  getModels: async (userId = 'default', forceRefresh = false): Promise<TTSModelsResponse> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/tts/models`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
    return data
  },

  getVoices: async (userId = 'default', forceRefresh = false): Promise<TTSVoicesResponse> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/tts/voices`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
    return data
  },

  getStatus: async (userId = 'default'): Promise<TTSStatusResponse> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/tts/status`, {
      params: { userId },
    })
    return data
  },

  synthesize: async (text: string, userId = 'default', signal?: AbortSignal): Promise<Blob> => {
    const { data } = await apiClient.post(
      `${API_BASE_URL}/api/tts/synthesize`,
      { text },
      {
        params: { userId },
        responseType: 'blob',
        signal,
      }
    )
    return data
  },
}
