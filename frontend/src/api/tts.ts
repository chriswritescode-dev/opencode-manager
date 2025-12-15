import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config'

async function fetchTTSModels(userId?: string, forceRefresh = false): Promise<{ models: string[]; cached: boolean }> {
  const url = new URL(`${API_BASE_URL}/api/tts/models`)
  if (userId) url.searchParams.set('userId', userId)
  if (forceRefresh) url.searchParams.set('refresh', 'true')

  const response = await fetch(url.toString())

  if (!response.ok) {
    let errorMessage = 'Failed to fetch TTS models'
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorMessage
    } catch {
      if (response.status === 400) errorMessage = 'TTS not configured'
      else if (response.status === 401) errorMessage = 'Invalid TTS API key'
      else if (response.status === 500) errorMessage = 'TTS service unavailable'
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

async function fetchTTSVoices(userId?: string, forceRefresh = false): Promise<{ voices: string[]; cached: boolean }> {
  const url = new URL(`${API_BASE_URL}/api/tts/voices`)
  if (userId) url.searchParams.set('userId', userId)
  if (forceRefresh) url.searchParams.set('refresh', 'true')

  const response = await fetch(url.toString())

  if (!response.ok) {
    let errorMessage = 'Failed to fetch TTS voices'
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorMessage
    } catch {
      if (response.status === 400) errorMessage = 'TTS not configured'
      else if (response.status === 401) errorMessage = 'Invalid TTS API key'
      else if (response.status === 500) errorMessage = 'TTS service unavailable'
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export function useTTSModels(userId?: string, enabled = true) {
  return useQuery({
    queryKey: ['tts-models', userId],
    queryFn: () => fetchTTSModels(userId),
    enabled,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
  })
}

export function useTTSVoices(userId?: string, enabled = true) {
  return useQuery({
    queryKey: ['tts-voices', userId],
    queryFn: () => fetchTTSVoices(userId),
    enabled,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
  })
}

export function useTTSDiscovery(userId?: string) {
  const queryClient = useQueryClient()

  const refreshModels = async () => {
    const result = await fetchTTSModels(userId, true)
    queryClient.setQueryData(['tts-models', userId], result)
    return result
  }

  const refreshVoices = async () => {
    const result = await fetchTTSVoices(userId, true)
    queryClient.setQueryData(['tts-voices', userId], result)
    return result
  }

  const refreshAll = async () => {
    const [models, voices] = await Promise.all([
      refreshModels(),
      refreshVoices()
    ])
    return { models, voices }
  }

  return {
    refreshModels,
    refreshVoices,
    refreshAll,
    invalidateModels: () => queryClient.invalidateQueries({ queryKey: ['tts-models', userId] }),
    invalidateVoices: () => queryClient.invalidateQueries({ queryKey: ['tts-voices', userId] }),
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['tts-models', userId] })
      queryClient.invalidateQueries({ queryKey: ['tts-voices', userId] })
    }
  }
}