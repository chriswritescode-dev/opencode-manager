import { useQuery } from '@tanstack/react-query'
import type { OpenCodeRecoveryAction } from '@opencode-manager/shared/opencode'
import { healthResponseSchema, type HealthResponse } from '@opencode-manager/shared/schemas'
import { fetchWrapper } from '@/api/fetchWrapper'

export type { HealthResponse }

export interface OpenCodeServerIssue {
  state: 'failed' | 'recovering' | 'unhealthy'
  message: string
  attemptedRecoveryActions: OpenCodeRecoveryAction[]
}

const DEFAULT_ISSUE_MESSAGE = 'OpenCode server is not responding'

async function fetchHealth(): Promise<HealthResponse> {
  return fetchWrapper('/api/health', healthResponseSchema, { acceptedStatuses: [503] })
}

export function getOpenCodeServerIssue(health: HealthResponse | undefined): OpenCodeServerIssue | null {
  if (!health) return null
  const lifecycle = health.opencodeLifecycle
  if (lifecycle) {
    const state = lifecycle.state
    if (state === 'failed' || state === 'recovering' || state === 'unhealthy') {
      return {
        state,
        message: lifecycle.lastError ?? health.error ?? DEFAULT_ISSUE_MESSAGE,
        attemptedRecoveryActions: lifecycle.attemptedRecoveryActions,
      }
    }
    if (state !== 'idle') return null
  }
  if (health.opencode === 'healthy') return null
  return {
    state: health.status === 'unhealthy' ? 'failed' : 'unhealthy',
    message: health.error ?? DEFAULT_ISSUE_MESSAGE,
    attemptedRecoveryActions: [],
  }
}

export function useServerHealth(enabled = true) {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
    retry: false,
    enabled,
    staleTime: 10000,
  })
}
