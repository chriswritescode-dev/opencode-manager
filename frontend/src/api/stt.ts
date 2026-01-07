import axios from 'axios'
import { API_BASE_URL } from '@/config'

export interface STTTranscribeResponse {
  text: string
  language: string
  language_probability: number
  duration: number
}

export interface STTModelsResponse {
  models: string[]
  current: string | null
  default: string
}

export interface STTStatusResponse {
  enabled: boolean
  configured: boolean
  server: {
    running: boolean
    port: number
    host: string
    model: string | null
    error: string | null
  }
  config: {
    model: string
    language: string
    autoSubmit: boolean
  }
}

export const sttApi = {
  transcribe: async (
    audioBlob: Blob,
    userId = 'default',
    options?: { model?: string; language?: string; signal?: AbortSignal }
  ): Promise<STTTranscribeResponse> => {
    const base64 = await blobToBase64(audioBlob)
    
    const { data } = await axios.post(
      `${API_BASE_URL}/api/stt/transcribe`,
      {
        audio: base64,
        format: getAudioFormat(audioBlob.type),
        model: options?.model,
        language: options?.language
      },
      {
        params: { userId },
        signal: options?.signal,
        timeout: 120000
      }
    )
    return data
  },

  transcribeBase64: async (
    base64Audio: string,
    format: string,
    options?: { model?: string; language?: string; signal?: AbortSignal },
    userId = 'default'
  ): Promise<STTTranscribeResponse> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/api/stt/transcribe`,
      {
        audio: base64Audio,
        format,
        model: options?.model,
        language: options?.language
      },
      {
        params: { userId },
        signal: options?.signal,
        timeout: 120000
      }
    )
    return data
  },

  getModels: async (): Promise<STTModelsResponse> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/stt/models`, {
      timeout: 10000
    })
    return data
  },

  getStatus: async (userId = 'default'): Promise<STTStatusResponse> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/stt/status`, {
      params: { userId },
      timeout: 10000
    })
    return data
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function getAudioFormat(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3'
  return 'webm'
}
