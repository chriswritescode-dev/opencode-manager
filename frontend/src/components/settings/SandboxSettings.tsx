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

  const sandbox = health?.sandbox
  const isAvailable = sandbox?.available === true
  const enabled = preferences?.sandbox?.enabled ?? false
  const gitCredentials = preferences?.sandbox?.gitCredentials ?? false

  const saveSandbox = async (next: { enabled: boolean; gitCredentials: boolean }, message: string) => {
    try {
      await updateSettingsAsync({ sandbox: next })
      showToast.success(message)
    } catch {
      showToast.error('Failed to update sandbox preference')
    }
  }

  const handleToggle = (next: boolean) =>
    saveSandbox({ enabled: next, gitCredentials }, next ? 'Sandboxing enabled' : 'Sandboxing disabled')

  const handleGitCredentialsToggle = (next: boolean) =>
    saveSandbox(
      { enabled, gitCredentials: next },
      next ? 'Git credentials will be forwarded into the sandbox' : 'Git credential forwarding disabled',
    )

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

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm">Git credentials in sandbox</p>
            <p className="text-xs text-muted-foreground">
              Forward git credentials into the microVM so sandboxed git and gh commands can authenticate. A
              prompt-injected agent can exfiltrate any credential you forward.
            </p>
          </div>
          <Switch
            checked={gitCredentials}
            disabled={isUpdating || !enabled}
            onCheckedChange={handleGitCredentialsToggle}
            aria-label="Toggle git credentials in sandbox"
          />
        </div>

        {health?.opencodeRestartPending && (
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
