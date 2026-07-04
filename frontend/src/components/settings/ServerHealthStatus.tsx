import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, ArrowUpCircle, RotateCcw, History } from 'lucide-react'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useManagerUpgrade } from '@/hooks/useManagerUpgrade'
import { useOpenCodeServerActions } from '@/hooks/useOpenCodeServerActions'
import { RestartServerDialog } from './RestartServerDialog'

interface ServerHealthStatusProps {
  onOpenVersionDialog?: () => void
}

export function ServerHealthStatus({ onOpenVersionDialog }: ServerHealthStatusProps) {
  const { data: health } = useServerHealth()
  const {
    isSupported,
    requestUpgrade,
    confirmUpgrade,
    confirmOpen: upgradeConfirmOpen,
    setConfirmOpen: setUpgradeConfirmOpen,
    activeSessionCount: upgradeActiveSessionCount,
    isUpgrading,
  } = useManagerUpgrade()
  const {
    restartServerMutation,
    upgradeOpenCodeMutation,
    confirmOpen,
    setConfirmOpen,
    activeSessionCount,
    requestRestart,
    confirmRestart,
    performUpgrade,
  } = useOpenCodeServerActions()

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
              onClick={performUpgrade}
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
              onClick={requestRestart}
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
            {isSupported && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestUpgrade}
                disabled={isUpgrading}
              >
                {isUpgrading ? (
                  <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                )}
                <span className="text-xs sm:text-sm">Upgrade Manager</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
      <RestartServerDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        activeSessionCount={activeSessionCount}
        isRestarting={restartServerMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmRestart}
      />
      <RestartServerDialog
        open={upgradeConfirmOpen}
        onOpenChange={setUpgradeConfirmOpen}
        isRestarting={isUpgrading}
        onCancel={() => setUpgradeConfirmOpen(false)}
        onConfirm={confirmUpgrade}
        title="Upgrade Manager?"
        description={`${upgradeActiveSessionCount} session${upgradeActiveSessionCount === 1 ? ' is' : 's are'} currently working. Upgrading recreates the container and will interrupt ${upgradeActiveSessionCount === 1 ? 'it' : 'them'}.`}
        confirmLabel="Upgrade now"
        pendingLabel="Upgrading..."
      />
    </Card>
  )
}
