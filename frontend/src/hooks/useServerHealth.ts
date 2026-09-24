import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches, invalidateSettingsCaches } from '@/lib/queryInvalidation'
import { fetchWrapper } from '@/api/fetchWrapper'

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  database: 'connected' | 'disconnected'
  opencode: 'healthy' | 'unhealthy'
  opencodePort: number
  opencodeVersion: string | null
  opencodeMinVersion: string
  opencodeVersionSupported: boolean
  opencodeManagerVersion: string | null
  opencodeRestartPending?: boolean
  sandbox?: { available: boolean; enabled: boolean; enforced: boolean; reason?: string; msbVersion?: string }
  error?: string
}

async function fetchHealth(): Promise<HealthResponse> {
  return fetchWrapper<HealthResponse>('/api/health')
}

export function useServerHealth(enabled = true) {
  const queryClient = useQueryClient()
  const lastHealthStatusRef = useRef<'healthy' | 'unhealthy'>('healthy')
  const prevHealthRef = useRef<string | null>(null)

  const restartMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.reloadOpenCodeConfig()
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success('OpenCode server restarted', { id: 'reload-config' })
    },
    onError: (error: unknown) => {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
           || 'Failed to restart OpenCode server')
        : 'Failed to restart OpenCode server'
      toast.error(errorMessage, { id: 'reload-config' })
    },
  })

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.rollbackOpenCodeConfig()
    },
    onSuccess: (data) => {
      invalidateSettingsCaches(queryClient)
      toast.success(data.message, { id: 'rollback-config' })
    },
    onError: () => {
      toast.error('Failed to rollback to previous config', { id: 'rollback-config' })
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

  useEffect(() => {
    if (!health) return

    const isUnhealthy = health.opencode !== 'healthy'
    const currentStatus = isUnhealthy ? 'unhealthy' : 'healthy'
    const previousStatus = lastHealthStatusRef.current
    const prevHealth = prevHealthRef.current

    if (prevHealth && currentStatus !== prevHealth) {
      if (isUnhealthy && previousStatus === 'healthy') {
        toast.error(health.error || 'OpenCode server is currently unhealthy', {
          id: 'server-health-unhealthy',
          duration: Infinity,
          action: {
            label: 'Restart',
            onClick: () => restartMutation.mutate(),
          },
        })
      } else if (!isUnhealthy && previousStatus === 'unhealthy') {
        toast.success('Server is back online', { id: 'server-health-online' })
      }
    }

    lastHealthStatusRef.current = currentStatus
    prevHealthRef.current = currentStatus
  }, [health, restartMutation])

  return {
    ...query,
    restartMutation,
    rollbackMutation,
  }
}
