import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface STTModelsResponse {
  models: string[]
  cached: boolean
}

export interface STTStatusResponse {
  enabled: boolean
  configured: boolean
  provider: 'external' | 'builtin'
  model: string
}

export interface STTTranscribeResponse {
  text: string
}

export interface STTErrorResponse {
  error: string
  details?: string
}

export const sttApi = {
  getModels: async (userId = 'default', forceRefresh = false): Promise<STTModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/models`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (userId = 'default'): Promise<STTStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/status`, {
      params: { userId },
    })
  },

  transcribe: async (
    audioBlob: Blob,
    userId = 'default',
    signal?: AbortSignal
  ): Promise<STTTranscribeResponse> => {
    const formData = new FormData()

    const type = audioBlob.type
    const extension =
      type.includes('wav') ? 'wav' :
      type.includes('webm') ? 'webm' :
      type.includes('ogg') ? 'ogg' :
      type.includes('mp4') ? 'm4a' : 'wav'
    formData.append('audio', audioBlob, `recording.${extension}`)

    return fetchWrapper<STTTranscribeResponse>(`${API_BASE_URL}/api/stt/transcribe`, {
      method: 'POST',
      params: { userId },
      body: formData,
      timeout: 60000,
      signal,
    })
  },
}
