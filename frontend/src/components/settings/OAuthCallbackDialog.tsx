import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ExternalLink, CheckCircle } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { showToast } from '@/lib/toast'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError } from '@/lib/oauthErrors'

interface OAuthCallbackDialogProps {
  providerId: string
  providerName: string
  authResponse: OAuthAuthorizeResponse
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const POLL_INTERVAL_MS = 2000

export function OAuthCallbackDialog({
  providerId,
  providerName,
  authResponse,
  open,
  onOpenChange,
  onSuccess,
}: OAuthCallbackDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isAutoMethod = authResponse.mode === 'auto'
  const completedRef = useRef(false)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  useEffect(() => {
    completedRef.current = false
    setIsLoading(false)
    setAuthCode('')
    setError(null)
  }, [authResponse.attemptID])

  useEffect(() => {
    if (!open || !isAutoMethod) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const poll = async () => {
      while (!cancelled) {
        try {
          const status = await oauthApi.getStatus(providerId, authResponse.attemptID)
          if (cancelled) return

          if (status.status === 'complete') {
            completedRef.current = true
            setIsLoading(false)
            onSuccessRef.current()
            return
          }

          if (status.status === 'failed' || status.status === 'expired') {
            setIsLoading(false)
            setError(status.message ?? 'Authentication failed')
            return
          }
        } catch (err) {
          if (!cancelled) {
            setIsLoading(false)
            setError(mapOAuthError(err, 'callback'))
          }
          return
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [open, isAutoMethod, providerId, authResponse.attemptID])

  const handleCallback = async () => {
    setIsLoading(true)
    setError(null)

    try {
      await oauthApi.callback(providerId, authResponse.attemptID, authCode.trim() || undefined)
      completedRef.current = true
      onSuccessRef.current()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenAuthUrl = () => {
    window.open(authResponse.url, '_blank')
  }

  const handleClose = () => {
    setError(null)
    setAuthCode('')

    if (!completedRef.current) {
      void oauthApi.cancel(providerId, authResponse.attemptID).catch(() => undefined)
    }

    onOpenChange(false)
  }

  // Extract device/user code from instructions (e.g., "Enter code: 596A-E304")
  const codeMatch = authResponse.instructions.match(/(?:Enter code|User code|Device code)[:\s]+([A-Z0-9-]+)/i)
  const deviceCode = codeMatch ? codeMatch[1] : ''

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete {providerName} Authentication</DialogTitle>
          <DialogDescription>
            {isAutoMethod
              ? 'Follow the instructions below to complete authentication.'
              : 'Enter the authorization code from the provider.'
            }
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="bg-muted p-3 rounded-md">
              <p className="text-sm mb-2">{authResponse.instructions}</p>

              {deviceCode && (
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 bg-background px-3 py-2 rounded text-sm font-mono">
                    {deviceCode}
                  </code>
                  <CopyButton
                    content={deviceCode}
                    title="Copy device code"
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success('Code copied to clipboard')}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleOpenAuthUrl}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Authorization Page
                </Button>
                <CopyButton
                  content={authResponse.url}
                  title="Copy authorization URL"
                  variant="ghost"
                  iconSize="sm"
                  className="flex-shrink-0"
                  onCopy={() => showToast.success('URL copied to clipboard')}
                />
              </div>
            </div>

            {!isAutoMethod && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="authCode">Authorization Code</Label>
                  <CopyButton
                    content={authCode}
                    title="Copy authorization code"
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success('Code copied to clipboard')}
                  />
                </div>
                <Input
                  id="authCode"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Enter the authorization code..."
                  className="bg-background border-border"
                  disabled={isLoading}
                />
                <Button
                  onClick={handleCallback}
                  className="w-full"
                  disabled={isLoading || !authCode.trim()}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Completing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Complete Authentication
                    </>
                  )}
                </Button>
              </div>
            )}

            {isAutoMethod && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for authorization to complete...
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
