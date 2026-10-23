import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, QrCode, RefreshCw } from 'lucide-react'
import {
  DEVICE_PAIRING_CODE_TTL_SECONDS,
  type DevicePairingLinkWarning,
  type DevicePairingLinksResponse,
} from '@opencode-manager/shared/schemas'
import { useCreateDevicePairingLinks, useInvalidatePairedDevices } from '@/hooks/useDevicePairing'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PairingQrCode } from './PairingQrCode'

const WARNING_MESSAGES: Record<DevicePairingLinkWarning, string> = {
  'plain-http': 'This address uses plain HTTP, so the sign-in code travels unencrypted.',
  loopback: 'This address is localhost; other devices cannot reach it.',
  'headers-unreadable': 'Stored remote access headers could not be decrypted and are not included.',
}

const LOOPBACK_EXPLANATION =
  'This page is open on localhost, which your phone cannot reach. Open the Manager at its public or LAN address to show the app QR code.'

const INSECURE_ORIGIN_EXPLANATION =
  "The mobile app QR code needs HTTPS. Use an HTTPS address, or turn on 'Allow plain-HTTP app links on private networks' if this Manager uses a private IP address."

const SCREEN_SHARING_WARNING =
  "This QR code contains your remote access headers. Don't show it while screen sharing or recording."

const BROWSER_HINT =
  "Scan with your phone camera to sign in the browser or installed app. In an iPhone home-screen app, use 'Sign in with QR code' on its sign-in screen."

const LINKS_FAILED_MESSAGE = 'Failed to create pairing links'

interface ConnectDeviceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatCountdown(localExpiresAt: number, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((localExpiresAt - now) / 1000))
  const minutes = Math.floor(remainingSeconds / 60)
  return `${minutes}:${String(remainingSeconds % 60).padStart(2, '0')}`
}

export function ConnectDeviceDialog({ open, onOpenChange }: ConnectDeviceDialogProps) {
  const invalidatePairedDevices = useInvalidatePairedDevices()
  const { mutate, isPending } = useCreateDevicePairingLinks()
  const [links, setLinks] = useState<DevicePairingLinksResponse | null>(null)
  const [localExpiresAt, setLocalExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const wasOpenRef = useRef(false)

  const requestLinks = useCallback(() => {
    setError(null)
    mutate(
      {},
      {
        onSuccess: (response) => {
          const receivedAt = Date.now()
          setLinks(response)
          setLocalExpiresAt(receivedAt + DEVICE_PAIRING_CODE_TTL_SECONDS * 1000)
          setNow(receivedAt)
        },
        onError: (requestError) => {
          setLinks(null)
          setLocalExpiresAt(null)
          setError(
            requestError instanceof Error && requestError.message
              ? requestError.message
              : LINKS_FAILED_MESSAGE,
          )
        },
      },
    )
  }, [mutate])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true
      setLinks(null)
      setLocalExpiresAt(null)
      setRevealed(false)
      requestLinks()
      return
    }

    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false
      setLinks(null)
      setLocalExpiresAt(null)
      setError(null)
      setRevealed(false)
      void invalidatePairedDevices()
    }
  }, [invalidatePairedDevices, open, requestLinks])

  useEffect(() => {
    if (!open || !links) return undefined
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [links, open])

  useEffect(() => {
    if (!open || !links || localExpiresAt === null || isPending) return
    if (now < localExpiresAt) return
    requestLinks()
  }, [isPending, links, localExpiresAt, now, open, requestLinks])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Connect a device
          </DialogTitle>
          <DialogDescription>
            Scan a code with the mobile app or your phone camera to sign in.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={requestLinks} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Try again
            </Button>
          </div>
        ) : !links ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm text-muted-foreground">Creating a pairing code…</p>
          </div>
        ) : (
          <div className="space-y-3">
            {localExpiresAt !== null && (
              <p className="text-sm text-muted-foreground">
                Expires in {formatCountdown(localExpiresAt, now)}
              </p>
            )}

            <Tabs defaultValue="mobile">
              <TabsList className="w-full">
                <TabsTrigger value="mobile" className="flex-1">
                  Mobile app
                </TabsTrigger>
                <TabsTrigger value="browser" className="flex-1">
                  Browser / PWA
                </TabsTrigger>
              </TabsList>

              <TabsContent value="mobile" className="space-y-3">
                {links.appLink ? (
                  <>
                    <div className="mx-auto w-full max-w-64">
                      <PairingQrCode
                        value={links.appLink}
                        label="Mobile app pairing QR code"
                        blurred={!revealed}
                      />
                    </div>
                    <Button variant="outline" onClick={() => setRevealed((current) => !current)}>
                      {revealed ? 'Hide QR code' : 'Reveal QR code'}
                    </Button>
                    <p className="text-xs text-muted-foreground">{SCREEN_SHARING_WARNING}</p>
                    <p className="text-xs text-muted-foreground">
                      {links.headerNames.length > 0
                        ? `Includes headers: ${links.headerNames.join(', ')}`
                        : 'No remote access headers are included.'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {links.appLinkBlockedReason === 'loopback'
                      ? LOOPBACK_EXPLANATION
                      : INSECURE_ORIGIN_EXPLANATION}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="browser" className="space-y-3">
                <div className="mx-auto w-full max-w-64">
                  <PairingQrCode value={links.browserLink} label="Browser sign-in QR code" />
                </div>
                <p className="text-xs text-muted-foreground">{BROWSER_HINT}</p>
              </TabsContent>
            </Tabs>

            {links.warnings.map((warning) => (
              <p key={warning} className="text-xs text-muted-foreground">
                {WARNING_MESSAGES[warning]}
              </p>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
