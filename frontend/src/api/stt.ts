import { z } from 'zod'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'

const sttModelsResponseSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })
const sttStatusResponseSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  provider: z.enum(['external', 'builtin']),
  model: z.string(),
})
const sttTranscribeResponseSchema = z.object({ text: z.string() })
const sttErrorResponseSchema = z.object({ error: z.string(), details: z.string().optional() })

export type STTModelsResponse = z.infer<typeof sttModelsResponseSchema>

export type STTStatusResponse = z.infer<typeof sttStatusResponseSchema>

export type STTTranscribeResponse = z.infer<typeof sttTranscribeResponseSchema>

export type STTErrorResponse = z.infer<typeof sttErrorResponseSchema>

export const sttApi = {
  getModels: async (userId = 'default', forceRefresh = false): Promise<STTModelsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/models`, sttModelsResponseSchema, {
      params: { userId, ...(forceRefresh && { refresh: 'true' }) },
    })
  },

  getStatus: async (userId = 'default'): Promise<STTStatusResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/stt/status`, sttStatusResponseSchema, {
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

    const urlObj = new URL(`${API_BASE_URL}/api/stt/transcribe`, window.location.origin)
    urlObj.searchParams.set('userId', userId)

    const controller = new AbortController()
    let timeoutFired = false
    const timeoutId = setTimeout(() => {
      timeoutFired = true
      controller.abort()
    }, 60000)

    if (signal?.aborted) {
      controller.abort()
    }
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await fetch(urlObj.toString(), {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)

      if (!response.ok) {
        const parsedError = sttErrorResponseSchema.safeParse(await response.json().catch(() => null))
        throw new FetchError(
          (parsedError.success ? parsedError.data.error : undefined) || 'Transcription failed',
          response.status,
        )
      }

      return sttTranscribeResponseSchema.parse(await response.json())
    } catch (error) {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)

      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted && !timeoutFired) {
          throw new FetchError('Transcription canceled', 499, 'CANCELED')
        }
        throw new FetchError('Transcription timeout', 408, 'TIMEOUT')
      }
      throw error
    }
  },
}
