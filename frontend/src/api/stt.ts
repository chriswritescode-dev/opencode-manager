import axios from 'axios'
import { API_BASE_URL } from '@/config'

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
    const { data } = await axios.get(`${API_BASE_URL}/api/stt/models`, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
    return data
  },

  getStatus: async (userId = 'default'): Promise<STTStatusResponse> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/stt/status`, {
      params: { userId },
    })
    return data
  },

  transcribe: async (
    audioBlob: Blob,
    userId = 'default',
    signal?: AbortSignal
  ): Promise<STTTranscribeResponse> => {
    const formData = new FormData()
    
    const extension = audioBlob.type.includes('webm') ? 'webm' : 
                      audioBlob.type.includes('ogg') ? 'ogg' :
                      audioBlob.type.includes('mp4') ? 'm4a' : 'webm'
    formData.append('audio', audioBlob, `recording.${extension}`)

    const { data } = await axios.post<STTTranscribeResponse>(
      `${API_BASE_URL}/api/stt/transcribe`,
      formData,
      {
        params: { userId },
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        signal,
      }
    )
    return data
  },
}
