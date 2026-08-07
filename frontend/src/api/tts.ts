import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperBlob } from './fetchWrapper'

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
    return fetchWrapper(`${API_BASE_URL}/api/tts/models`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getVoices: async (userId = 'default', forceRefresh = false): Promise<TTSVoicesResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/voices`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (userId = 'default'): Promise<TTSStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/status`, {
      params: { userId },
    })
  },

  synthesize: async (text: string, userId = 'default', signal?: AbortSignal): Promise<Blob> => {
    return fetchWrapperBlob(`${API_BASE_URL}/api/tts/synthesize`, {
      method: 'POST',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      timeout: 60000,
      signal,
    })
  },
}
