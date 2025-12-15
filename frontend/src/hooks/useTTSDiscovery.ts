import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ttsApi } from '@/api/tts'

export function useTTSModels(userId = 'default', enabled = true) {
  return useQuery({
    queryKey: ['tts-models', userId],
    queryFn: () => ttsApi.getModels(userId),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })
}

export function useTTSVoices(userId = 'default', enabled = true) {
  return useQuery({
    queryKey: ['tts-voices', userId],
    queryFn: () => ttsApi.getVoices(userId),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })
}

export function useTTSDiscovery(userId = 'default') {
  const queryClient = useQueryClient()

  const refreshModels = async () => {
    const result = await ttsApi.getModels(userId, true)
    queryClient.setQueryData(['tts-models', userId], result)
    return result
  }

  const refreshVoices = async () => {
    const result = await ttsApi.getVoices(userId, true)
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
