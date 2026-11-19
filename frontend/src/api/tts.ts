import { z } from 'zod'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperBlob } from './fetchWrapper'

const ttsModelsResponseSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })
const ttsVoicesResponseSchema = z.object({ voices: z.array(z.string()), cached: z.boolean() })
const ttsClearCacheResponseSchema = z.object({ cleared: z.number() })
const ttsStatusResponseSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  cache: z.object({
    count: z.number(),
    sizeBytes: z.number(),
    sizeMB: z.number(),
    maxSizeMB: z.number(),
    ttlHours: z.number(),
  }),
})

export type TTSModelsResponse = z.infer<typeof ttsModelsResponseSchema>

export type TTSVoicesResponse = z.infer<typeof ttsVoicesResponseSchema>

export type TTSClearCacheResponse = z.infer<typeof ttsClearCacheResponseSchema>

export type TTSStatusResponse = z.infer<typeof ttsStatusResponseSchema>

export const ttsApi = {
  getModels: async (userId = 'default', forceRefresh = false): Promise<TTSModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/models`, ttsModelsResponseSchema, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getVoices: async (userId = 'default', forceRefresh = false): Promise<TTSVoicesResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/voices`, ttsVoicesResponseSchema, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (userId = 'default'): Promise<TTSStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/status`, ttsStatusResponseSchema, {
      params: { userId },
    })
  },

  clearCache: async (): Promise<TTSClearCacheResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/tts/cache`, ttsClearCacheResponseSchema, {
      method: 'DELETE',
    })
  },

  synthesize: async (text: string, userId = 'default', signal?: AbortSignal): Promise<Blob> => {
    return fetchWrapperBlob(`${API_BASE_URL}/api/tts/synthesize`, {
      method: 'POST',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
  },
}
