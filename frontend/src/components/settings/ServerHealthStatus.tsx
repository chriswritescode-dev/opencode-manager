import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, ArrowUpCircle, RotateCcw, History, Plus } from 'lucide-react'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'

interface ServerHealthStatusProps {
  onCreateConfig?: () => void
  onOpenVersionDialog?: () => void
}

export function ServerHealthStatus({ onCreateConfig, onOpenVersionDialog }: ServerHealthStatusProps) {
  const queryClient = useQueryClient()
  const { data: health } = useServerHealth()

  const restartServerMutation = useMutation({
    mutationFn: async () => settingsApi.restartOpenCodeServer(),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
    },
  })

  const upgradeOpenCodeMutation = useMutation({
    mutationFn: async () => settingsApi.upgradeOpenCode(),
    onSuccess: (data) => {
      if (data.upgraded && data.newVersion) {
        queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
          if (!old) return old
          return { ...old, opencodeVersion: data.newVersion }
        })
      }
      invalidateConfigCaches(queryClient)
      if (data.upgraded) {
        showToast.success(`Upgraded to v${data.newVersion} and server restarted`, { id: 'upgrade-opencode' })
      } else {
        showToast.success('OpenCode is already up to date', { id: 'upgrade-opencode' })
      }
    },
    onError: (error) => {
      const defaultMessage = 'Failed to upgrade OpenCode'

      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { recovered?: boolean; recoveryMessage?: string; newVersion?: string } } }).response
        const data = response?.data

        if (data?.recovered && data.newVersion) {
          queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
            if (!old) return old
            return { ...old, opencodeVersion: data.newVersion }
          })
          showToast.success(`Upgrade failed but server recovered at v${data.newVersion}`, { id: 'upgrade-opencode' })
        } else {
          showToast.error(data?.recoveryMessage || defaultMessage, { id: 'upgrade-opencode' })
        }
      } else {
        showToast.error(defaultMessage, { id: 'upgrade-opencode' })
      }
      invalidateConfigCaches(queryClient)
    },
  })

  if (!health) {
    return (
      <Card className="bg-transparent border-transparent">
        <CardContent className="p-3">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading server status...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isUnhealthy = health.opencode !== 'healthy'

  return (
    <Card className={cn('bg-transparent border-transparent', isUnhealthy && 'border-destructive')}>
      <CardContent className="p-3">
        <div className="flex flex-col sm:flex-row sm:items-center items-center justify-center gap-3">
          <div className="flex items-center gap-2 flex-wrap justify-center ">
            <div className={`h-3 w-3 rounded-full ${isUnhealthy ? 'bg-destructive animate-pulse' : 'bg-green-500'}`} />
            <p className="font-medium text-sm sm:text-base">
              Server Status: {isUnhealthy ? 'Unhealthy' : 'Healthy'}
            </p>
            {health.error && (
              <p className="text-xs text-destructive">
                {health.error}
              </p>
            )}
            {health.opencodeVersion && (
              <p className="text-xs text-muted-foreground">
                OpenCode v{health.opencodeVersion}
              </p>
            )}
            {health.opencodeManagerVersion && (
              <p className="text-xs text-muted-foreground">
                Manager v{health.opencodeManagerVersion}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                showToast.loading('Upgrading OpenCode...', { id: 'upgrade-opencode' })
                try {
                  await upgradeOpenCodeMutation.mutateAsync()
                } catch (error) {
                  const errorMessage = error && typeof error === 'object' && 'response' in error
                    ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
                       || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
                       || 'Failed to upgrade OpenCode')
                    : 'Failed to upgrade OpenCode'
                  showToast.error(errorMessage, { id: 'upgrade-opencode' })
                }
              }}
              disabled={upgradeOpenCodeMutation.isPending}
            >
              {upgradeOpenCodeMutation.isPending ? (
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              )}
              <span className="text-xs sm:text-sm">Update</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                showToast.loading('Restarting OpenCode server...', { id: 'manual-restart' })
                try {
                  await restartServerMutation.mutateAsync()
                  showToast.success('Server restarted successfully', { id: 'manual-restart' })
                } catch (error) {
                  const errorMessage = error && typeof error === 'object' && 'response' in error
                    ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
                       || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
                       || 'Failed to restart OpenCode server')
                    : 'Failed to restart OpenCode server'
                  showToast.error(errorMessage, { id: 'manual-restart' })
                }
              }}
              disabled={restartServerMutation.isPending}
            >
              {restartServerMutation.isPending ? (
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              )}
              <span className="text-xs sm:text-sm">Restart</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenVersionDialog}
            >
              <History className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              <span className="text-xs sm:text-sm">Versions</span>
            </Button>
            <Button
              size="sm"
              onClick={onCreateConfig}
            >
              <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              <span className="text-xs sm:text-sm">New Config</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
