import { useQuery } from '@tanstack/react-query'
import { sttApi } from '@/api/stt'

export function useSTTModels(enabled = true) {
  return useQuery({
    queryKey: ['stt-models'],
    queryFn: () => sttApi.getModels(),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  })
}

export function useSTTStatus(userId = 'default', enabled = true) {
  return useQuery({
    queryKey: ['stt-status', userId],
    queryFn: () => sttApi.getStatus(userId),
    enabled,
    staleTime: 30 * 1000,
    gcTime: 60 * 1000,
  })
}
