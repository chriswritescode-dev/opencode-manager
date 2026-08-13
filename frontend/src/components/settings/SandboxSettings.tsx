import { useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useServerHealth } from '@/hooks/useServerHealth'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Box, RotateCcw } from 'lucide-react'
import { showToast } from '@/lib/toast'

export function SandboxSettings() {
  const { preferences, updateSettingsAsync, isUpdating } = useSettings()
  const { data: health } = useServerHealth()
  const [needsRestart, setNeedsRestart] = useState(false)

  const sandbox = health?.sandbox
  const isAvailable = sandbox?.available === true
  const enabled = preferences?.sandbox?.enabled ?? false

  const handleToggle = async (next: boolean) => {
    try {
      await updateSettingsAsync({ sandbox: { enabled: next } })
      setNeedsRestart(true)
      showToast.success(next ? 'Sandboxing enabled' : 'Sandboxing disabled')
    } catch {
      showToast.error('Failed to update sandbox preference')
    }
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h3 className="text-sm font-semibold truncate">Sandbox</h3>
          </div>
          {sandbox?.msbVersion && (
            <Badge variant="outline" className="text-xs shrink-0">
              msb {sandbox.msbVersion}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm text-muted-foreground">
              Run OpenCode agent commands inside microVMs for isolation.
            </p>
            {sandbox === undefined ? (
              <p className="text-xs text-muted-foreground">Checking sandbox availability...</p>
            ) : !isAvailable && (
              <p className="text-xs text-destructive">
                {sandbox.reason ?? 'Sandboxing is unavailable on this host.'}
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            disabled={isUpdating || (!isAvailable && !enabled)}
            onCheckedChange={handleToggle}
            aria-label="Toggle sandbox"
          />
        </div>

        {needsRestart && (
          <Alert>
            <RotateCcw className="h-4 w-4" />
            <AlertDescription>
              Restart the OpenCode server to apply sandbox changes.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
