import { useState } from 'react'
import { AlertCircle, QrCode } from 'lucide-react'
import { useDevicePairingAvailability } from '@/hooks/useDevicePairing'
import { useSettings } from '@/hooks/useSettings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ConnectDeviceDialog } from './ConnectDeviceDialog'

const ALLOW_PRIVATE_NETWORK_HTTP_LABEL = 'Allow plain-HTTP app links on private networks'

export function ConnectDeviceSettings() {
  const { preferences, updateSettings } = useSettings()
  const [dialogOpen, setDialogOpen] = useState(false)
  const availability = useDevicePairingAvailability()
  const allowPrivateNetworkHttp = preferences?.devicePairing?.allowPrivateNetworkHttp ?? false
  const isPairingAvailable = availability.data?.available !== false
  const unavailableMessage =
    availability.data?.available === false ? availability.data.message : null

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <QrCode className="h-4 w-4 sm:h-5 sm:w-5" />
          Connect a device
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Pair the mobile app or sign another browser in with a QR code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={availability.isLoading || !isPairingAvailable}
        >
          Show QR code
        </Button>

        {unavailableMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{unavailableMessage}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="allow-private-network-http" className="text-xs sm:text-sm">
              {ALLOW_PRIVATE_NETWORK_HTTP_LABEL}
            </Label>
            <p className="text-xs text-muted-foreground">
              Lets the mobile app QR code use a LAN address without HTTPS.
            </p>
          </div>
          <Switch
            id="allow-private-network-http"
            aria-label={ALLOW_PRIVATE_NETWORK_HTTP_LABEL}
            checked={allowPrivateNetworkHttp}
            onCheckedChange={(checked) =>
              updateSettings({ devicePairing: { allowPrivateNetworkHttp: checked } })
            }
          />
        </div>
      </CardContent>

      <ConnectDeviceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
