import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { describeUserAgent } from '@opencode-manager/shared/utils'
import type { PairedDevice } from '@opencode-manager/shared/schemas'
import { usePairedDevices, useRevokePairedDevice } from '@/hooks/useDevicePairing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AlertCircle, Loader2, MonitorSmartphone, Trash2 } from 'lucide-react'

function deviceLabel(device: PairedDevice): string {
  return device.deviceName?.trim() || describeUserAgent(device.userAgent)
}

export function PairedDevicesSettings() {
  const { data: devices, isLoading } = usePairedDevices()
  const revoke = useRevokePairedDevice()
  const [deviceToRevoke, setDeviceToRevoke] = useState<PairedDevice | null>(null)

  const error = revoke.error instanceof Error
    ? revoke.error.message
    : revoke.error
      ? 'Failed to revoke device'
      : null

  const handleConfirmRevoke = () => {
    if (!deviceToRevoke) return
    revoke.mutate(deviceToRevoke.id)
    setDeviceToRevoke(null)
  }

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <MonitorSmartphone className="h-4 w-4 sm:h-5 sm:w-5" />
          Paired devices
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Every signed-in browser and app. Revoking one signs out only that device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !devices || devices.length === 0 ? (
          <p className="text-xs sm:text-sm text-muted-foreground">No paired devices.</p>
        ) : (
          <div className="space-y-2">
            {devices.map((device) => {
              const label = deviceLabel(device)

              return (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2.5 sm:p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{label}</p>
                      {device.isCurrent && (
                        <Badge variant="secondary" className="shrink-0">
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {device.ipAddress ? `${device.ipAddress} · ` : null}
                      Signed in {formatDistanceToNow(new Date(device.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!device.isCurrent && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-2 h-8 w-8 shrink-0"
                      aria-label={`Revoke ${label}`}
                      onClick={() => setDeviceToRevoke(device)}
                      disabled={revoke.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <DeleteDialog
        open={deviceToRevoke !== null}
        onOpenChange={(open) => !open && setDeviceToRevoke(null)}
        onConfirm={handleConfirmRevoke}
        onCancel={() => setDeviceToRevoke(null)}
        title="Revoke device"
        description={deviceToRevoke ? `${deviceLabel(deviceToRevoke)} will be signed out.` : ''}
        isDeleting={revoke.isPending}
      />
    </Card>
  )
}
