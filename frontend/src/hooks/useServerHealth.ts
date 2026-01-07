import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from '@/api/settings'
import { useMutation } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/lib/auth'

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  database: 'connected' | 'disconnected'
  opencode: 'healthy' | 'unhealthy'
  opencodePort: number
  opencodeVersion: string | null
  opencodeMinVersion: string
  opencodeVersionSupported: boolean
  error?: string
}

async function fetchHealth(): Promise<HealthResponse> {
  const response = await authFetch('/api/health')
  if (!response.ok) {
    throw new Error('Health check failed')
  }
  return response.json()
}

let lastHealthStatus: 'healthy' | 'unhealthy' = 'healthy'

export function useServerHealth(enabled = true) {
  const queryClient = useQueryClient()

  const restartMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.restartOpenCodeServer()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      toast.success('Server restarted successfully')
    },
    onError: (error: unknown) => {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
           || 'Failed to restart server')
        : 'Failed to restart server'
      toast.error(errorMessage)
    },
  })

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.rollbackOpenCodeConfig()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      toast.success(data.message)
    },
    onError: () => {
      toast.error('Failed to rollback to previous config')
    },
  })

  const query = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
    retry: false,
    enabled,
    staleTime: 10000,
  })

  const { data: health } = query

  if (health) {
    const isUnhealthy = health.opencode !== 'healthy'

    if (isUnhealthy && lastHealthStatus === 'healthy') {
      toast.error(health.error || 'OpenCode server is currently unhealthy', {
        duration: Infinity,
        action: {
          label: 'Restart',
          onClick: () => restartMutation.mutate(),
        },
      })
    } else if (!isUnhealthy && lastHealthStatus === 'unhealthy') {
      toast.success('Server is back online')
    }

    lastHealthStatus = isUnhealthy ? 'unhealthy' : 'healthy'
  }

  return {
    ...query,
    restartMutation,
    rollbackMutation,
  }
}